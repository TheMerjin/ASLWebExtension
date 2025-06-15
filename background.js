// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('ASL Web Translator extension installed');
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  if (message.type === 'log') {
    console.log(`[ASL Debug] ${message.message}`, message.data);
  } else if (message.type === 'error') {
    console.error(`[ASL Debug] ${message.message}`, message.error);
  }
  sendResponse({ received: true });
}); 