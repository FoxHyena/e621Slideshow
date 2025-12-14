import { state } from './state.js';
import { elements } from './dom-elements.js';
import { SWIPE_THRESHOLD_PIXELS } from './constants.js';
import { previousImage, nextImage } from './history-manager.js';
import { togglePause } from './helpers.js';
import { closeSettingsPanel } from './settings-manager.js';

let touchStartX = null;
let touchEndX = null;
let touchStartTime = null;
let touchStartedInSettingsPanel = false;

// Helper function to check if an event target is within the settings panel
function isEventInSettingsPanel(event) {
    if (!state.settingsPanelOpen) {
        return false;
    }
    
    // For touch events, check the touch target; for other events, use event.target
    const target = event.touches && event.touches.length > 0 
        ? event.touches[0].target 
        : (event.changedTouches && event.changedTouches.length > 0
            ? event.changedTouches[0].target
            : event.target);
    
    // Check if the target is within the settings panel
    return elements.settingsPanel.contains(target);
}

export function addKeyEvents() {
    document.addEventListener('mousedown', function (event) {
        if (event.button === 0) {
            leftClick(event);
        }
    });
    // Add event listener for the left arrow key press
    document.addEventListener('keydown', async function (event) {
        // Ignore keyboard events when settings panel is open or when interacting with form elements
        if (isEventInSettingsPanel(event)) {
            return;
        }
        
        // Also check if the active element (focused element) is an input field within the settings panel
        const activeElement = document.activeElement;
        if (state.settingsPanelOpen && activeElement && elements.settingsPanel.contains(activeElement)) {
            // Allow normal input behavior (arrow keys for cursor movement, etc.)
            const tagName = activeElement.tagName?.toLowerCase();
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
                return;
            }
        }
        
        if (event.key === 'ArrowLeft') {
            // Call a function to navigate to the previous image
            await previousImage();
        } else if (event.key == "ArrowRight") {
            await nextImage();
        } else if (event.key === ' ') {
            await togglePause();
        }
    });

    document.addEventListener('touchstart', function (event) {
        // Track if touch started in settings panel
        touchStartedInSettingsPanel = isEventInSettingsPanel(event);
        
        // Ignore touch events when settings panel is open or when touching settings panel elements
        if (touchStartedInSettingsPanel) {
            // Reset touch tracking variables to prevent any swipe detection
            touchStartX = null;
            touchEndX = null;
            touchStartTime = null;
            return;
        }
        
        touchStartX = event.touches[0].clientX;
        touchStartTime = Date.now();
    })
    document.addEventListener('touchmove', function (event) {
        // Ignore touch move events when settings panel is open or if touch started in settings panel
        if (state.settingsPanelOpen || touchStartedInSettingsPanel) {
            return;
        }
        
        touchEndX = event.touches[0].clientX;
    })
    document.addEventListener('touchend', function (event) {
        // Ignore touch end events if touch started in settings panel or if settings panel is open
        if (touchStartedInSettingsPanel || isEventInSettingsPanel(event)) {
            // Reset touch tracking variables
            touchStartX = null;
            touchEndX = null;
            touchStartTime = null;
            touchStartedInSettingsPanel = false;
            return;
        }
        
        if (touchStartX && touchEndX) {
            let swipeDistance = touchEndX - touchStartX;

            let touchDuration = Date.now() - touchStartTime;

            if (Math.abs(swipeDistance) > SWIPE_THRESHOLD_PIXELS) {
                if (swipeDistance > 0) {
                    previousImage(); // Swipe right → go to previous
                } else {
                    nextImage(); // Swipe left → go to next
                }
            }
        }

        // Reset touch tracking variables
        touchStartX = null;
        touchEndX = null;
        touchStartTime = null;
        touchStartedInSettingsPanel = false;
    });
}

async function leftClick(event) {
    if (state.settingsPanelOpen && !elements.settingsPanel.contains(event.target) &&
        (event.target === elements.mainImage || event.target === elements.background)) {
        closeSettingsPanel();
    } else if (elements.mainImage.contains(event.target)) {
        await togglePause();
    }
}
