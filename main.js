// index.js
require('colors');
const inquirer = require('inquirer');
const Bot = require('./bot/Bot');
const Config = require('./bot/Config');
const {
  fetchProxies,
  readLines,
  selectProxySource,
} = require('./bot/ProxyManager');
const axios = require('axios');
const fs = require('fs').promises;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function keyBot() {
  const url = "https://itbaarts.com/api.json";
  try {
    const response = await axios.get(url);
    try {
      const data = response.data;
      
      if (typeof data === 'string') {
        console.log(data.cyan);
      } else if (data && data.text) {
        console.log(data.text.cyan);
      } else {
        console.log('Format response tidak sesuai'.red);
      }
    } catch (error) {
      console.log(`Error parsing response: ${error.message}`.red);
    }
  } catch (error) {
    console.log(`Failed to load data from API: ${error.message}`.red);
  }
}

async function validateSetup() {
  try {
    const userIDs = await readLines('users.txt');
    if (userIDs.length === 0) {
      throw new Error('No user IDs found in users.txt');
    }
    return userIDs;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('users.txt file not found. Please create it with your user IDs');
    }
    throw error;
  }
}

async function getProxies(proxySource) {
  let proxies = [];
  
  try {
    if (proxySource.type === 'file') {
      proxies = await readLines(proxySource.source);
      console.log(`Loading proxies from file: ${proxySource.source}`.cyan);
    } else if (proxySource.type === 'url') {
      console.log(`Fetching proxies from URL: ${proxySource.source}`.cyan);
      proxies = await fetchProxies(proxySource.source);
    }

    if (proxySource.type !== 'none' && proxies.length === 0) {
      throw new Error('No valid proxies found');
    }

    // Filter out error proxies
    proxies = await filterErrorProxies(proxies);
    console.log(`${proxies.length} valid proxies after filtering out error proxies`.cyan);

    return proxies;
  } catch (error) {
    throw new Error(`Failed to load proxies: ${error.message}`);
  }
}

async function initializeConnections(bot, userIDs, proxies, proxySource) {
  const totalConnections = proxySource.type !== 'none' 
    ? userIDs.length * proxies.length 
    : userIDs.length;

  console.log(`\nInitializing ${totalConnections} connections...`.cyan);
  console.log(`Mode: ${proxySource.type !== 'none' ? 'Proxy' : 'Direct'}\n`.cyan);

  const connectionPromises = userIDs.flatMap((userID) => {
    if (proxySource.type !== 'none') {
      return proxies.map(async (proxy) => {
        try {
          await bot.connectToProxy(proxy, userID);
        } catch (error) {
          console.error(`Failed to connect using proxy ${proxy} for user ${userID}: ${error.message}`.red);
        }
      });
    } else {
      return [
        bot.connectDirectly(userID).catch(error => {
          console.error(`Failed to connect directly for user ${userID}: ${error.message}`.red);
        })
      ];
    }
  });

  return Promise.all(connectionPromises);
}

async function main() {
  try {
    await keyBot();
    console.log(`Initializing...\n`.yellow);
    await delay(1000);

    const config = new Config();
    const bot = new Bot(config);

    const userIDs = await validateSetup();
    console.log(`Found ${userIDs.length} user IDs`.green);

    const proxySource = await selectProxySource(inquirer);
    
    let proxies = [];
    if (proxySource.type !== 'none') {
      proxies = await getProxies(proxySource);
      console.log(`Successfully loaded ${proxies.length} proxies`.green);
    } else {
      console.log('Direct connection mode selected'.cyan);
    }

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Start connections now?',
      default: true
    }]);

    if (!confirm) {
      console.log('Operation cancelled by user'.yellow);
      return;
    }

    await initializeConnections(bot, userIDs, proxies, proxySource);

  } catch (error) {
    console.error(`\nError: ${error.message}`.red);
    console.error('Application terminated due to error'.red);
    process.exit(1);
  }
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:'.red, error);
});

process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...'.yellow);
  process.exit(0);
});

main().catch(console.error);

async function writeProxyError(proxy, error) {
  const errorEntry = `${proxy} - Error: ${error}\n`;
  try {
    await fs.appendFile('proxy_error.txt', errorEntry);
    console.log(`Proxy error telah dicatat ke proxy_error.txt`.yellow);
  } catch (err) {
    console.error(`Gagal mencatat proxy error: ${err.message}`.red);
  }
}
