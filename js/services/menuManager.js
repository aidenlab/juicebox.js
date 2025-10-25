/*
 * MenuManager - Handles menu creation and visibility
 * Extracted from HICBrowser for better separation of concerns
 */

class MenuManager {
    constructor(rootElement, browser) {
        this.rootElement = rootElement;
        this.browser = browser;
        this.menuElement = null;
    }

    createMenu(rootElement) {
        const html = `
        <div class="hic-menu" style="display: none;">
            <div class="hic-menu-close-button">
                <i class="fa fa-times"></i>
            </div>
            <div class="hic-chromosome-selector-widget-container">
                <div>Chromosomes</div>
                <div>
                    <select name="x-axis-selector"></select>
                    <select name="y-axis-selector"></select>
                    <div></div>
                </div>
            </div>
            <div class="hic-annotation-presentation-button-container">
                <button type="button">2D Annotations</button>
            </div>
        </div>`;

        const template = document.createElement('template');
        template.innerHTML = html.trim();
        const menuElement = template.content.firstChild;

        rootElement.appendChild(menuElement);

        const closeButton = menuElement.querySelector(".fa-times");
        closeButton.addEventListener('click', () => this.toggleMenu());

        this.menuElement = menuElement;
        return menuElement;
    }

    toggleMenu() {
        if (this.menuElement.style.display === "flex") {
            this.hideMenu();
        } else {
            this.showMenu();
        }
    }

    showMenu() {
        if (this.menuElement) {
            this.menuElement.style.display = "flex";
        }
    }

    hideMenu() {
        if (this.menuElement) {
            this.menuElement.style.display = "none";
        }
    }

    getMenuElement() {
        return this.menuElement;
    }
}

export default MenuManager;
