// HOA Lot Mapper - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
    // Check if we're on Google Maps
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const statusCard = document.getElementById('status-card');

        if (tab.url && tab.url.includes('google.com/maps')) {
            statusCard.innerHTML = `
        <div class="status-icon">✅</div>
        <div class="status-text">
          <p class="status-main">Extension Active</p>
          <p class="status-sub">Use the overlay toolbar on the map</p>
        </div>
      `;
            statusCard.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
        }
    } catch (error) {
        console.log('Could not check tab status:', error);
    }
});
