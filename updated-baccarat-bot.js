// Baccarat Automation Script for Stake.com
// Automates betting with customizable settings
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'Stake.env') }); // Load from Stake.env file

class BaccaratAutomationBot {
  constructor(config) {
    // Configuration settings with defaults from the screenshot
    this.config = {
      username: config.username,
      password: config.password,
      headless: config.headless || false,
      betAmount: config.betAmount || 0.00000001, // Default from screenshot
      chipValue: config.chipValue || 0.00000001, // Default from screenshot
      
      // Autobet settings from screenshot
      onWinIncrease: config.onWinIncrease || 0, // 0% increase on win
      onWinIncreaseType: config.onWinIncreaseType || 'percentage', // percentage or fixed
      
      onLossIncrease: config.onLossIncrease || 100, // 100% increase on loss
      onLossIncreaseType: config.onLossIncreaseType || 'percentage', // percentage or fixed
      
      stopOnProfit: config.stopOnProfit || 0.00000000, // Stop on profit value
      stopOnLoss: config.stopOnLoss || 0.00000064, // Stop on loss value
      
      maxBets: config.maxBets || Infinity, // Infinity means unlimited bets (∞ in the UI)
      strategy: config.strategy || 'banker', // Default strategy
      
      // Recovery settings
      recoverMode: config.recoverMode || 'restart', // Default to restart if autobet stops
      customRecoveryFunction: config.customRecoveryFunction || null,
      
      // Advanced settings
      screenshotsEnabled: config.screenshotsEnabled || true,
      screenshotDir: config.screenshotDir || './screenshots',
      logDetailLevel: config.logDetailLevel || 'info', // 'debug', 'info', 'warn', 'error'
      
      // Timeouts
      navigationTimeout: config.navigationTimeout || 30000,
      actionTimeout: config.actionTimeout || 5000,
      
      ...config
    };
    
    // Store original settings to revert to when needed
    this.originalConfig = {...this.config};
    
    this.browser = null;
    this.page = null;
    this.currentBalance = 0;
    this.startingBalance = 0;
    this.betCount = 0;
    this.autoBetActive = false;
    this.session = {
      wins: 0,
      losses: 0,
      profit: 0,
      history: [],
      startTime: null,
      endTime: null
    };
    
    // Ensure screenshot directory exists
    if (this.config.screenshotsEnabled) {
      const fs = require('fs');
      if (!fs.existsSync(this.config.screenshotDir)) {
        fs.mkdirSync(this.config.screenshotDir, { recursive: true });
      }
    }
  }

  log(level, message, data = null) {
    const levels = {
      'debug': 0,
      'info': 1,
      'warn': 2,
      'error': 3
    };
    
    if (levels[level] >= levels[this.config.logDetailLevel]) {
      const timestamp = new Date().toISOString();
      let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      
      if (data) {
        if (typeof data === 'object') {
          logMessage += ` ${JSON.stringify(data)}`;
        } else {
          logMessage += ` ${data}`;
        }
      }
      
      console.log(logMessage);
    }
  }

  async takeScreenshot(name) {
    if (!this.config.screenshotsEnabled || !this.page) return;
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `${this.config.screenshotDir}/${name}_${timestamp}.png`;
      await this.page.screenshot({ path, fullPage: true });
      this.log('debug', `Screenshot saved: ${path}`);
    } catch (error) {
      this.log('error', `Failed to take screenshot: ${error.message}`);
    }
  }

  async initialize() {
    try {
      this.log('info', 'Launching browser...');
      this.browser = await puppeteer.launch({
        headless: this.config.headless,
        defaultViewport: null,
        args: ['--window-size=1366,768', '--no-sandbox', '--disable-setuid-sandbox']
      });
      
      this.page = await this.browser.newPage();
      
      // Set default timeout
      this.page.setDefaultNavigationTimeout(this.config.navigationTimeout);
      this.page.setDefaultTimeout(this.config.actionTimeout);
      
      // Login process
      const loggedIn = await this.login();
      if (!loggedIn) {
        throw new Error('Login failed');
      }
      
      // Navigate to Baccarat game
      await this.navigateToBaccarat();
      
      // Get initial balance
      this.startingBalance = await this.getBalance();
      this.currentBalance = this.startingBalance;
      
      this.log('info', `Starting balance: ${this.startingBalance} BTC`);
      this.session.startTime = new Date();
      
      await this.takeScreenshot('initialized');
      return true;
    } catch (error) {
      this.log('error', `Initialization failed: ${error.message}`);
      await this.takeScreenshot('initialization_error');
      return false;
    }
  }

  async login() {
    try {
      this.log('info', 'Logging in...');
      await this.page.goto('https://stake.com/login', { waitUntil: 'networkidle2' });
      await this.takeScreenshot('login_page');
      
      // Updated selectors based on Stake.com structure
      await this.page.waitForSelector('input[type="email"]', { visible: true });
      await this.page.waitForSelector('input[type="password"]', { visible: true });
      
      // Fill in login details
      await this.page.type('input[type="email"]', this.config.username);
      await this.page.type('input[type="password"]', this.config.password);
      
      // Click login button - updated selector
      await this.page.click('button[type="submit"]');
      
      // Wait for successful login - check for balance indicator
      try {
        await this.page.waitForSelector('[data-test="balance"]', { visible: true, timeout: 15000 });
        this.log('info', 'Login successful');
        await this.takeScreenshot('login_successful');
        
        // Check for CAPTCHA
        const hasCaptcha = await this.page.evaluate(() => {
          return document.body.textContent.includes('CAPTCHA') || 
                 document.body.innerHTML.includes('captcha') ||
                 document.querySelector('iframe[src*="captcha"]') !== null;
        });
        
        if (hasCaptcha) {
          this.log('warn', 'CAPTCHA detected. Manual intervention required.');
          // Wait longer for manual CAPTCHA solving
          await this.page.waitForTimeout(30000);
        }
        
        return true;
      } catch (error) {
        // Check if there's an error message
        const errorMsgVisible = await this.page.evaluate(() => {
          const errorEls = document.querySelectorAll('.error, .error-message, [class*="error"]');
          return errorEls.length > 0;
        });
        
        if (errorMsgVisible) {
          const errorMsg = await this.page.evaluate(() => {
            const errorEls = document.querySelectorAll('.error, .error-message, [class*="error"]');
            return errorEls.length > 0 ? errorEls[0].textContent : 'Unknown error';
          });
          this.log('error', `Login error: ${errorMsg}`);
        }
        
        await this.takeScreenshot('login_failed');
        throw new Error('Login verification failed');
      }
    } catch (error) {
      this.log('error', `Login process failed: ${error.message}`);
      return false;
    }
  }

  async navigateToBaccarat() {
    try {
      this.log('info', 'Navigating to Baccarat...');
      // Navigate to the baccarat game page
      await this.page.goto('https://stake.com/casino/games/baccarat', { waitUntil: 'networkidle2' });
      
      // Wait for game to load - updated selector
      await this.page.waitForSelector('.game-container, .game-wrapper, [data-test="game-container"]', { timeout: 30000 });
      
      // Check if we need to click to start the game
      const playButtons = await this.page.$$('button:is(:contains("Play"), :contains("Play Now"), :contains("Start"))');
      if (playButtons.length > 0) {
        await playButtons[0].click();
        await this.page.waitForTimeout(5000); // Wait for game to initialize
      }
      
      this.log('info', 'Baccarat game loaded');
      await this.takeScreenshot('baccarat_loaded');
      return true;
    } catch (error) {
      this.log('error', `Navigation to Baccarat failed: ${error.message}`);
      await this.takeScreenshot('navigation_failed');
      return false;
    }
  }

  async getBalance() {
    try {
      // Updated selector for balance
      await this.page.waitForSelector('[data-test="balance"], .balance-amount, .balance-value', { timeout: 5000 });
      const balance = await this.page.evaluate(() => {
        const balanceEl = document.querySelector('[data-test="balance"], .balance-amount, .balance-value');
        if (!balanceEl) return 0;
        // Extract just the number from the balance text and convert to float
        return parseFloat(balanceEl.textContent.replace(/[^0-9.-]+/g, ''));
      });
      
      this.log('debug', `Current balance: ${balance} BTC`);
      return balance;
    } catch (error) {
      this.log('error', `Failed to get balance: ${error.message}`);
      return this.currentBalance; // Return last known balance
    }
  }

  async placeBet(type) {
    try {
      this.log('info', `Placing bet on ${type}...`);
      
      // Updated selectors for betting areas
      const betSelectors = {
        player: '[data-bet="player"], .player-bet-area, [data-role="player"]',
        banker: '[data-bet="banker"], .banker-bet-area, [data-role="banker"]'
      };
      
      const betSelector = betSelectors[type];
      await this.page.waitForSelector(betSelector, { visible: true });
      await this.page.click(betSelector);
      
      // Set bet amount using the current chip value and amount
      await this.selectChipValue(this.config.chipValue);
      await this.setBetAmount(this.config.betAmount);
      
      // Confirm bet - updated selector
      await this.page.click('[data-test="confirm-bet"], .confirm-bet-button, button:is(:contains("Confirm"), :contains("Place Bet"))');
      
      this.log('info', `Bet placed on ${type}: ${this.config.betAmount} BTC`);
      this.betCount++;
      await this.takeScreenshot(`bet_placed_${type}`);
      return true;
    } catch (error) {
      this.log('error', `Failed to place bet: ${error.message}`);
      await this.takeScreenshot('bet_error');
      return false;
    }
  }

  async selectChipValue(value) {
    try {
      // Updated implementation to select the correct chip value
      this.log('debug', `Selecting chip value: ${value} BTC`);
      
      // Try multiple approaches to find and select chips
      const chipFound = await this.page.evaluate((targetValue) => {
        // First approach: Try to find buttons with the exact value
        const chipButtons = Array.from(document.querySelectorAll('[data-value], .chip, [class*="chip"]'));
        for (const button of chipButtons) {
          const buttonValue = button.getAttribute('data-value') || button.textContent;
          if (buttonValue && buttonValue.includes(targetValue)) {
            button.click();
            return true;
          }
        }
        
        // Second approach: Try to find by position for predefined chips
        const allChips = Array.from(document.querySelectorAll('[data-value], .chip, [class*="chip"]'));
        if (allChips.length > 0) {
          // Choose position based on value
          let index = 0;
          switch (targetValue.toString()) {
            case '0.00000001': index = 0; break;
            case '0.0000001': index = 1; break;
            case '0.000001': index = 2; break;
            case '0.00001': index = 3; break;
            default: index = 0;
          }
          
          if (index < allChips.length) {
            allChips[index].click();
            return true;
          }
        }
        
        return false;
      }, value.toString());
      
      if (!chipFound) {
        this.log('warn', `Chip value ${value} not found automatically, trying direct selector`);
        
        // Try direct click by index
        const chips = await this.page.$$('[data-value], .chip, [class*="chip"]');
        if (chips.length > 0) {
          let index = 0;
          await chips[index].click();
          this.log('info', `Selected first available chip`);
        }
      }
      
      return true;
    } catch (error) {
      this.log('error', `Failed to select chip value: ${error.message}`);
      return false;
    }
  }

  async setBetAmount(amount) {
    try {
      // Updated implementation to set the bet amount
      this.log('debug', `Setting bet amount: ${amount} BTC`);
      
      // Find and clear the bet amount input - updated selectors
      const betInputFound = await this.page.evaluate((amt) => {
        // Try multiple selectors for bet input
        const betInputs = document.querySelectorAll('input[type="number"], .bet-amount-input, [data-test="bet-amount"]');
        
        for (const input of betInputs) {
          // Clear the input
          input.value = '';
          // Set the new value
          input.value = amt;
          // Trigger input event to update UI
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        
        return false;
      }, amount.toString());
      
      if (!betInputFound) {
        this.log('warn', 'Bet input not found via JS, trying Puppeteer input');
        // Try direct input via Puppeteer
        const betInput = await this.page.$('input[type="number"], .bet-amount-input, [data-test="bet-amount"]');
        if (betInput) {
          await betInput.click({ clickCount: 3 }); // Select all text
          await betInput.type(amount.toString());
        } else {
          this.log('error', 'No bet input found');
        }
      }
      
      return true;
    } catch (error) {
      this.log('error', `Failed to set bet amount: ${error.message}`);
      return false;
    }
  }

  async switchToAutoTab() {
    try {
      this.log('debug', 'Switching to Auto tab');
      
      // Updated selectors for Auto tab
      const autoTabSelectors = [
        'button:has-text("Auto")',
        'button[data-test="auto-tab"]',
        'button:is(:contains("Auto"), :contains("Autobet"))',
        '[role="tab"]:is(:contains("Auto"), :contains("Autobet"))'
      ];
      
      // Try all selectors
      for (const selector of autoTabSelectors) {
        try {
          const autoTab = await this.page.$(selector);
          if (autoTab) {
            await autoTab.click();
            await this.page.waitForTimeout(1000); // Wait for UI to update
            this.log('debug', `Found Auto tab with selector: ${selector}`);
            return true;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // If we reach here, try to find any tab containing "Auto"
      const foundAutoTab = await this.page.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button, [role="tab"]'));
        const autoButton = allButtons.find(btn => 
          btn.textContent.includes('Auto') || btn.textContent.includes('Autobet')
        );
        
        if (autoButton) {
          autoButton.click();
          return true;
        }
        return false;
      });
      
      if (!foundAutoTab) {
        this.log('warn', 'Auto tab not found. UI may be different than expected.');
        return false;
      }
      
      return true;
    } catch (error) {
      this.log('error', `Failed to switch to Auto tab: ${error.message}`);
      return false;
    }
  }

  async configureAutoBet() {
    try {
      this.log('info', 'Configuring AutoBet...');
      
      // Switch to Auto tab
      await this.switchToAutoTab();
      await this.takeScreenshot('autobet_tab');
      
      // Set chip value
      await this.selectChipValue(this.config.chipValue);
      
      // Using more robust approach to configure AutoBet
      const configSuccess = await this.page.evaluate((config) => {
        try {
          // Helper function to find elements by text content
          const findElementByText = (selector, text) => {
            const elements = Array.from(document.querySelectorAll(selector));
            return elements.find(el => el.textContent.includes(text));
          };
          
          // Helper function to find input field in a section
          const findInputInSection = (sectionText) => {
            const section = findElementByText('div, section, fieldset', sectionText);
            if (!section) return null;
            
            return section.querySelector('input');
          };
          
          // Set bet amount
          const betAmountInput = document.querySelector('input[type="number"], .bet-amount-input, [data-test="bet-amount"]');
          if (betAmountInput) {
            betAmountInput.value = config.betAmount;
            betAmountInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          // Set number of bets
          const betsInput = findInputInSection('Number of bets') || document.querySelector('input[placeholder="0"]');
          if (betsInput) {
            betsInput.value = config.maxBets === Infinity ? '0' : config.maxBets.toString();
            betsInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          // Configure On Win settings
          const onWinInput = findInputInSection('On Win');
          if (onWinInput) {
            onWinInput.value = config.onWinIncrease.toString();
            onWinInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          // Configure On Loss settings
          const onLossInput = findInputInSection('On Loss');
          if (onLossInput) {
            onLossInput.value = config.onLossIncrease.toString();
            onLossInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          // Set Stop on Profit
          const stopProfitInput = findInputInSection('Stop on Profit');
          if (stopProfitInput) {
            stopProfitInput.value = config.stopOnProfit.toString();
            stopProfitInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          // Set Stop on Loss
          const stopLossInput = findInputInSection('Stop on Loss');
          if (stopLossInput) {
            stopLossInput.value = config.stopOnLoss.toString();
            stopLossInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          return true;
        } catch (error) {
          console.error('Error in configureAutoBet JS:', error);
          return false;
        }
      }, this.config);
      
      if (!configSuccess) {
        this.log('warn', 'JS configuration approach failed, trying direct Puppeteer approach');
        
        // Try to set bet amount using Puppeteer
        const betInput = await this.page.$('input[type="number"], .bet-amount-input, [data-test="bet-amount"]');
        if (betInput) {
          await betInput.click({ clickCount: 3 });
          await betInput.type(this.config.betAmount.toString());
        }
        
        // Find other settings inputs by label text and set values
        const settingsLabels = [
          { text: 'On Win', value: this.config.onWinIncrease.toString() },
          { text: 'On Loss', value: this.config.onLossIncrease.toString() },
          { text: 'Stop on Profit', value: this.config.stopOnProfit.toString() },
          { text: 'Stop on Loss', value: this.config.stopOnLoss.toString() }
        ];
        
        for (const { text, value } of settingsLabels) {
          try {
            // Find elements containing the text
            const elements = await this.page.$$(`div:has-text("${text}"), label:has-text("${text}")`);
            for (const element of elements) {
              // Find input in the parent element
              const input = await element.$('input');
              if (input) {
                await input.click({ clickCount: 3 });
                await input.type(value);
                break;
              }
            }
          } catch (e) {
            this.log('warn', `Failed to set ${text}: ${e.message}`);
          }
        }
      }
      
      this.log('info', 'AutoBet configured');
      await this.takeScreenshot('autobet_configured');
      return true;
    } catch (error) {
      this.log('error', `Failed to configure AutoBet: ${error.message}`);
      await this.takeScreenshot('autobet_config_error');
      return false;
    }
  }

  async startAutoBet() {
    try {
      this.log('info', 'Starting AutoBet...');
      
      // Configure auto bet first
      const configured = await this.configureAutoBet();
      if (!configured) {
        throw new Error('Failed to configure AutoBet');
      }
      
      // Updated selectors for start button
      const startButtonSelectors = [
        'button:has-text("Start Autobet")',
        'button[data-test="start-autobet"]',
        'button:is(:contains("Start"), :contains("Auto"))',
        'button.start-button'
      ];
      
      // Try each selector
      let startButtonClicked = false;
      for (const selector of startButtonSelectors) {
        try {
          const startButton = await this.page.$(selector);
          if (startButton) {
            await startButton.click();
            startButtonClicked = true;
            this.log('debug', `Found start button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // If direct selectors failed, try to find by text
      if (!startButtonClicked) {
        const buttonFound = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const startButton = buttons.find(btn => 
            btn.textContent.includes('Start') && 
            (btn.textContent.includes('Auto') || btn.textContent.includes('Bet'))
          );
          
          if (startButton) {
            startButton.click();
            return true;
          }
          return false;
        });
        
        if (!buttonFound) {
          this.log('error', 'Could not find start autobet button');
          throw new Error('Start button not found');
        }
      }
      
      this.autoBetActive = true;
      this.log('info', 'AutoBet started');
      await this.takeScreenshot('autobet_started');
      
      // Monitor auto bet status
      this.monitorAutoBet();
      
      return true;
    } catch (error) {
      this.log('error', `Failed to start AutoBet: ${error.message}`);
      await this.takeScreenshot('start_autobet_error');
      return false;
    }
  }

  async monitorAutoBet() {
    this.log('info', 'Monitoring AutoBet status...');
    
    try {
      // Setup a check interval
      const checkInterval = setInterval(async () => {
        try {
          // Updated approach to check if autobet is running
          const isActive = await this.page.evaluate(() => {
            // Look for stop button, active state indicators, or running text
            const stopButton = document.querySelector(
              'button:is(:contains("Stop"), :contains("Cancel"))'
            );
            
            // Look for active state indicators
            const activeIndicator = document.querySelector(
              '.active, [data-active="true"], [data-state="running"]'
            );
            
            // Look for text indicating running status
            const runningText = document.body.textContent.includes('running') ||
                               document.body.textContent.includes('in progress');
            
            return !!stopButton || !!activeIndicator || runningText;
          });
          
          // Update current balance
          this.currentBalance = await this.getBalance();
          
          // Calculate profit/loss
          const currentProfit = this.currentBalance - this.startingBalance;
          this.session.profit = currentProfit;
          
          this.log('info', `Current balance: ${this.currentBalance} BTC, Profit: ${currentProfit} BTC`);
          
          // If auto bet is not active anymore
          if (!isActive && this.autoBetActive) {
            this.autoBetActive = false;
            clearInterval(checkInterval);
            this.log('info', 'AutoBet has stopped');
            await this.takeScreenshot('autobet_stopped');
            this.handleAutoBetStopped('unknown');
          }
        } catch (error) {
          this.log('error', `Error during monitoring: ${error.message}`);
          await this.takeScreenshot('monitoring_error');
          
          // If we encounter a serious error in monitoring, consider stopping auto bet
          clearInterval(checkInterval);
          await this.stopAutoBet();
          this.handleAutoBetStopped('monitoring_error');
        }
      }, 5000); // Check every 5 seconds
    } catch (error) {
      this.log('error', `Failed to setup monitoring: ${error.message}`);
    }
  }

  async stopAutoBet() {
    try {
      this.log('info', 'Stopping AutoBet...');
      
      if (!this.autoBetActive) {
        this.log('info', 'AutoBet is not active');
        return true;
      }
      
      // Updated selectors for stop button
      const stopButtonSelectors = [
        'button:has-text("Stop Autobet")',
        'button[data-test="stop-autobet"]',
        'button:is(:contains("Stop"), :contains("Cancel"))',
        'button.stop-button'
      ];
      
      // Try each selector
      let stopButtonClicked = false;
      for (const selector of stopButtonSelectors) {
        try {
          const stopButton = await this.page.$(selector);
          if (stopButton) {
            await stopButton.click();
            stopButtonClicked = true;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // If direct selectors failed, try to find by text
      if (!stopButtonClicked) {
        const buttonFound = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const stopButton = buttons.find(btn => 
            btn.textContent.includes('Stop') || 
            btn.textContent.includes('Cancel')
          );
          
          if (stopButton) {
            stopButton.click();
            return true;
          }
          return false;
        });
        
        if (!buttonFound) {
          this.log('warn', 'Stop button not found, AutoBet may have already stopped');
        }
      }
      
      this.autoBetActive = false;
      this.log('info', 'AutoBet stopped');
      await this.takeScreenshot('autobet_manually_stopped');
      return true;
    } catch (error) {
      this.log('error', `Failed to stop AutoBet: ${error.message}`);
      return false;
    }
  }

  handleAutoBetStopped(reason) {
    this.log('info', `AutoBet stopped due to: ${reason}`);
    this.session.endTime = new Date();
    
    const sessionDuration = (this.session.endTime - this.session.startTime) / 1000; // in seconds
    this.log('info', `Session duration: ${sessionDuration} seconds`);
    this.log('info', `Session stats: ${JSON.stringify(this.getSessionStats())}`);
    
    switch (this.config.recoverMode) {
      case 'restart':
        this.log('info', 'Restarting with original settings');
        // Reset configuration to original values
        this.config = {...this.originalConfig};
        this.log('info', 'Settings reset to original values');
        // Start a new autobet session after a delay
        setTimeout(() => {
          this.log('info', 'Initiating restart...');
          this.startAutoBet();
        }, 5000); // 5 second delay before restarting
        break;
      
      case 'pause':
        this.log('info', 'Pausing operation as configured');
        break;
      
      case 'notify':
        this.log('info', 'Sending notification to user');
        this.sendNotification(`AutoBet stopped: ${reason}`);
        break;
      
      case 'custom':
        if (this.config.customRecoveryFunction) {
          this.log('info', 'Executing custom recovery function');
          this.config.customRecoveryFunction(this, reason);
        } else {
          this.log('warn', 'No custom recovery function defined');
        }
        break;
      
      default:
        this.log('info', 'No recovery mode specified');
    }
  }

  sendNotification(message) {
    // Placeholder for notification implementation
    this.log('info', `NOTIFICATION: ${message}`);
    // Could integrate with email, SMS, push notifications, etc.
  }

  async close() {
    try {
      this.log('info', 'Closing browser...');
      
      if (this.browser) {
        await this.browser.close();
      }
      
      this.log('info', 'Browser closed');
      return true;
    } catch