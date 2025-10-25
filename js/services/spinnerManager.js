/*
 * SpinnerManager - Handles spinner and interaction shield state management
 * Extracted from HICBrowser for better separation of concerns
 */

class SpinnerManager {
    constructor(contactMatrixView, userInteractionShield) {
        this.contactMatrixView = contactMatrixView;
        this.userInteractionShield = userInteractionShield;
    }

    startSpinner() {
        if (this.contactMatrixView) {
            this.contactMatrixView.startSpinner();
        }
    }

    stopSpinner() {
        if (this.contactMatrixView) {
            this.contactMatrixView.stopSpinner();
        }
    }

    showInteractionShield() {
        if (this.userInteractionShield) {
            this.userInteractionShield.style.display = 'block';
        }
    }

    hideInteractionShield() {
        if (this.userInteractionShield) {
            this.userInteractionShield.style.display = 'none';
        }
    }
}

export default SpinnerManager;
