// Baccarat Automation Script for Stake.com
// Automates betting with customizable settings
const puppeteer = require('puppeteer');
require('dotenv').config(); // For environment variables

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
      
      // Wait for login form elements - update selectors based on actual site
      await this.page.waitForSelector('input[name="email"]', { visible: true });
      await this.page.waitForSelector('input[name="password"]', { visible: true });
      
      // Fill in login details
      await this.page.type('input[name="email"]', this.config.username);
      await this.page.type('input[name="password"]', this.config.password);
      
      // Click login button - update selector based on actual site
      await this.page.click('button[type="submit"]');
      
      // Wait for successful login - check for a home page element
      try {
        await this.page.waitForSelector('.user-balance', { visible: true, timeout: 10000 });
        this.log('info', 'Login successful');
        await this.takeScreenshot('login_successful');
        return true;
      } catch (error) {
        // Check if there's an error message
        const errorMsgVisible = await this.page.evaluate(() => {
          const errorEl = document.querySelector('.error-message');
          return errorEl && errorEl.offsetParent !== null;
        });
        
        if (errorMsgVisible) {
          const errorMsg = await this.page.evaluate(() => {
            return document.querySelector('.error-message').textContent;
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
      // Navigate to the baccarat game page - update URL as needed
      await this.page.goto('https://stake.com/casino/games/baccarat', { waitUntil: 'networkidle2' });
      
      // Wait for game to load - update selector based on actual site
      await this.page.waitForSelector('.game-container', { timeout: 30000 });
      
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
      // Implementation to get balance from the website
      // This is highly dependent on the site structure - update selector based on actual site
      await this.page.waitForSelector('.balance-amount', { timeout: 5000 });
      const balance = await this.page.evaluate(() => {
        const balanceEl = document.querySelector('.balance-amount');
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
      
      // Find and click the appropriate betting area - update selectors based on actual site
      const betSelector = type === 'player' ? '.player-bet-area' : '.banker-bet-area';
      await this.page.waitForSelector(betSelector, { visible: true });
      await this.page.click(betSelector);
      
      // Set bet amount using the current chip value and amount
      await this.selectChipValue(this.config.chipValue);
      await this.setBetAmount(this.config.betAmount);
      
      // Confirm bet - update selector based on actual site
      await this.page.click('.confirm-bet-button');
      
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
      // Implementation to select the correct chip value
      this.log('debug', `Selecting chip value: ${value} BTC`);
      
      // Based on the screenshot, there are labeled chip values
      // Map the value to the correct button index
      let buttonIndex;
      
      // This mapping will need to be adjusted based on actual UI
      switch (value.toString()) {
        case '0.00000001':
          buttonIndex = 1; // First button
          break;
        case '0.0000001':
          buttonIndex = 2; // Second button (10)
          break;
        case '0.000001':
          buttonIndex = 3; // Third button (100)
          break;
        case '0.00001':
          buttonIndex = 4; // Fourth button (1K)
          break;
        default:
          // Try to find button by text
          const buttonFound = await this.page.evaluate((targetValue) => {
            const buttons = Array.from(document.querySelectorAll('.chip-button'));
            const button = buttons.find(b => b.textContent.includes(targetValue));
            if (button) {
              button.click();
              return true;
            }
            return false;
          }, value.toString());
          
          if (buttonFound) return true;
          
          this.log('warn', `Chip value ${value} not found, using default`);
          buttonIndex = 1; // Default to first button
      }
      
      // Click the appropriate button - update selector based on actual site
      await this.page.click(`.chip-button:nth-child(${buttonIndex})`);
      
      return true;
    } catch (error) {
      this.log('error', `Failed to select chip value: ${error.message}`);
      return false;
    }
  }

  async setBetAmount(amount) {
    try {
      // Implementation to set the bet amount
      this.log('debug', `Setting bet amount: ${amount} BTC`);
      
      // Find and clear the bet amount input - update selector based on actual site
      await this.page.evaluate(() => {
        const input = document.querySelector('.bet-amount-input');
        if (input) input.value = '';
      });
      
      // Type the new amount - update selector based on actual site
      await this.page.type('.bet-amount-input', amount.toString());
      
      return true;
    } catch (error) {
      this.log('error', `Failed to set bet amount: ${error.message}`);
      return false;
    }
  }

  async switchToAutoTab() {
    try {
      this.log('debug', 'Switching to Auto tab');
      
      // Check if we're already on Auto tab
      const isAutoActive = await this.page.evaluate(() => {
        const autoButton = document.querySelector('button:has-text("Auto")');
        return autoButton && autoButton.classList.contains('active');
      });
      
      if (!isAutoActive) {
        // Click the Auto tab button - update selector based on screenshot
        await this.page.click('button:has-text("Auto")');
        await this.page.waitForTimeout(500); // Wait for UI to update
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
      
      // Set bet amount - update selector based on actual UI
      // Based on screenshot, there's an input with a BTC icon
      await this.page.evaluate((amount) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const betInput = inputs.find(input => 
          input.parentElement && input.parentElement.querySelector('.btc-icon'));
        if (betInput) betInput.value = amount;
      }, this.config.betAmount.toString());
      
      // Click in the input to ensure value is set
      await this.page.click('input:first-of-type');
      await this.page.type('input:first-of-type', this.config.betAmount.toString());
      
      // Set number of bets (0 for unlimited/infinity) - based on screenshot
      const betsInput = await this.page.$('input[placeholder="0"]');
      if (betsInput) {
        await betsInput.click({ clickCount: 3 }); // Select all text
        await betsInput.type(this.config.maxBets === Infinity ? '0' : this.config.maxBets.toString());
      }
      
      // Configure On Win settings - update selectors based on screenshot
      // First find the "On Win" section and its Reset button
      await this.page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('div'));
        const onWinSection = sections.find(div => div.textContent.includes('On Win'));
        if (onWinSection) {
          const resetButton = onWinSection.querySelector('button');
          if (resetButton) resetButton.click();
        }
      });
      
      // Set On Win increase value if not zero
      if (this.config.onWinIncrease > 0) {
        await this.page.evaluate((value) => {
          const sections = Array.from(document.querySelectorAll('div'));
          const onWinSection = sections.find(div => div.textContent.includes('On Win'));
          if (onWinSection) {
            const input = onWinSection.querySelector('input');
            if (input) {
              input.value = value;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        }, this.config.onWinIncrease.toString());
      }
      
      // Configure On Loss settings - update selectors based on screenshot
      // Find the "On Loss" section and its Reset button
      await this.page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('div'));
        const onLossSection = sections.find(div => div.textContent.includes('On Loss'));
        if (onLossSection) {
          const resetButton = onLossSection.querySelector('button');
          if (resetButton) resetButton.click();
        }
      });
      
      // Set On Loss increase value
      await this.page.evaluate((value) => {
        const sections = Array.from(document.querySelectorAll('div'));
        const onLossSection = sections.find(div => div.textContent.includes('On Loss'));
        if (onLossSection) {
          const input = onLossSection.querySelector('input');
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, this.config.onLossIncrease.toString());
      
      // Set Stop on Profit - update selectors based on screenshot
      await this.page.evaluate((value) => {
        const sections = Array.from(document.querySelectorAll('div'));
        const stopProfitSection = sections.find(div => div.textContent.includes('Stop on Profit'));
        if (stopProfitSection) {
          const input = stopProfitSection.querySelector('input');
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, this.config.stopOnProfit.toString());
      
      // Set Stop on Loss - update selectors based on screenshot
      await this.page.evaluate((value) => {
        const sections = Array.from(document.querySelectorAll('div'));
        const stopLossSection = sections.find(div => div.textContent.includes('Stop on Loss'));
        if (stopLossSection) {
          const input = stopLossSection.querySelector('input');
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, this.config.stopOnLoss.toString());
      
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
      
      // Start auto bet by clicking the green button - update selector based on screenshot
      await this.page.click('button:has-text("Start Autobet")');
      
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
          // Check if auto bet is still active - update selector based on actual site
          const isActive = await this.page.evaluate(() => {
            // Look for the "Stop Autobet" button which indicates autobet is running
            const stopButton = document.querySelector('button:has-text("Stop Autobet")');
            return !!stopButton;
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
      
      // Click stop button - update selector based on actual site
      const stopButton = await this.page.$('button:has-text("Stop Autobet")');
      if (stopButton) {
        await stopButton.click();
        this.autoBetActive = false;
        this.log('info', 'AutoBet stopped');
        await this.takeScreenshot('autobet_manually_stopped');
        return true;
      } else {
        this.log('warn', 'Stop button not found, AutoBet may have already stopped');
        this.autoBetActive = false;
        return false;
      }
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
    } catch (error) {
      this.log('error', `Failed to close browser: ${error.message}`);
      return false;
    }
  }

  getSessionStats() {
    const duration = this.session.endTime 
      ? (this.session.endTime - this.session.startTime) / 1000
      : (new Date() - this.session.startTime) / 1000;
    
    return {
      startingBalance: this.startingBalance,
      currentBalance: this.currentBalance,
      profit: this.session.profit,
      betCount: this.betCount,
      duration: `${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`,
      ...this.session
    };
  }
}

// Example usage with the specific values from the screenshot
const startBot = async () => {
  // Load credentials from environment variables
  const username = process.env.STAKE_USERNAME;
  const password = process.env.STAKE_PASSWORD;
  
  if (!username || !password) {
    console.error('Error: Missing credentials. Please set STAKE_USERNAME and STAKE_PASSWORD environment variables.');
    console.error('Create a .env file with these values or set them in your environment.');
    process.exit(1);
  }
  
  const bot = new BaccaratAutomationBot({
    username,
    password,
    headless: false, // Set to true to run without visible browser
    betAmount: 0.00000001, // Base bet amount from screenshot
    chipValue: 0.00000001, // Chip value from screenshot
    maxBets: Infinity, // Set to infinity (∞) as shown in screenshot
    strategy: 'banker', // Default strategy
    
    // Values from screenshot
    onWinIncrease: 0,
    onWinIncreaseType: 'percentage',
    onLossIncrease: 100,
    onLossIncreaseType: 'percentage',
    stopOnProfit: 0.00000000,
    stopOnLoss: 0.00000064,
    
    // If autobet stops for any reason, revert to original settings and restart
    recoverMode: 'restart',
    
    // Enable screenshots for debugging
    screenshotsEnabled: true,
    logDetailLevel: 'info' // Use 'debug' for more detailed logs
  });

  console.log('Initializing bot...');
  const initialized = await bot.initialize();
  
  if (initialized) {
    console.log('Starting AutoBet...');
    await bot.startAutoBet();
  } else {
    console.error('Failed to initialize bot');
    await bot.close();
    process.exit(1);
  }
  
  // Handle process termination
  process.on('SIGINT', async () => {
    console.log('Received SIGINT. Gracefully shutting down...');
    await bot.stopAutoBet();
    await bot.close();
    process.exit(0);
  });
};

// Uncomment the next line to run the bot

module.exports = {
  BaccaratAutomationBot,
  startBot
};
