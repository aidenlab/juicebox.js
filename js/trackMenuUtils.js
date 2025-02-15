import {createCheckbox} from "./igv-icons.js"

/**
 * Configure item list for track "gear" menu.
 * @param trackRenderer
 */
const MenuUtils = {

    trackMenuItemList: trackPair => {

        const menuItems = []

        menuItems.push(trackRenameMenuItem(trackPair))
        menuItems.push("<hr/>")

        menuItems.push(colorPickerMenuItem({ trackPair, label: "Set color", option: "color" }))
        menuItems.push(unsetColorMenuItem({ trackPair, label: "Unset color" }))

        if (trackPair.track.removable !== false) {
            menuItems.push('<hr/>');
            menuItems.push(trackRemovalMenuItem(trackPair))
        }

        return menuItems
    },

    numericDataMenuItems: trackPair => {
        const menuItems = [];

        // Data range
        const element = document.createElement('div');
        element.textContent = 'Set data range';

        const click = () => {
            const { min, max } = trackPair.track.dataRange;
            trackPair.dataRangeDialog.show({ min: min || 0, max });
        };

        menuItems.push({ element, click });

        if (trackPair.track.logScale !== undefined) {
            menuItems.push({
                element: createCheckbox("Log scale", trackPair.track.logScale),
                click: () => {
                    trackPair.track.logScale = !trackPair.track.logScale;
                    trackPair.repaintViews();
                }
            });
        }

        menuItems.push({
            element: createCheckbox("Autoscale", trackPair.track.autoscale),
            click: () => {
                trackPair.track.autoscale = !trackPair.track.autoscale;
                trackPair.repaintViews();
            }
        });

        return menuItems;
    },

    nucleotideColorChartMenuItems: trackPair => {
        const menuItems = [];
        menuItems.push(document.createElement('hr'));

        const element = document.createElement('div');
        element.className = 'jb-igv-menu-popup-chart';
        element.innerHTML = `
        <div>A</div>
        <div>C</div>
        <div>T</div>
        <div>G</div>
    `;

        const click = e => {
            e.preventDefault();
            e.stopPropagation();
        };

        menuItems.push({ element, click });

        return menuItems;
    }

}

function trackRemovalMenuItem(trackPair) {
    const element = document.createElement('div');
    element.textContent = 'Remove track';

    const click = () => trackPair.browser.layoutController.removeTrackXYPair(trackPair);

    return { element, click };
}

function colorPickerMenuItem({ trackPair, label, option }) {
    const element = document.createElement('div');
    element.textContent = label;

    const click = () => trackPair.colorPicker.show();

    return { element, click };
}

function unsetColorMenuItem({ trackPair, label }) {
    const element = document.createElement('div');
    element.textContent = label;

    const click = () => {
        trackPair.track.color = undefined;
        trackPair.repaintViews();
    };

    return { element, click };
}

function trackRenameMenuItem(trackPair) {
    const element = document.createElement('div');
    element.textContent = 'Set track name';

    const click = e => {
        const callback = value => {
            let name;
            if (value === '' || value === undefined) {
                name = '';
            } else {
                name = value.trim();
            }
            trackPair.track.name = name;
        };

        const value = trackPair.track.name || '';
        trackPair.browser.inputDialog.present({ label: 'Track Name', value, callback }, e);
    };

    return { element, click };
}

export default MenuUtils
