import $ from "../vendor/jquery-3.3.1.slim.js";
import {createCheckbox} from "./igv-icons.js"

/**
 * Configure item list for track "gear" menu.
 * @param trackRenderer
 */
const MenuUtils = {

    trackMenuItemList: function (trackPair) {


        let menuItems = [];

        menuItems.push(trackRenameMenuItem(trackPair));
        menuItems.push("<hr/>");
        menuItems.push(colorPickerMenuItem({trackRenderer: trackPair, label: "Set color", option: "color"}));
        menuItems.push(unsetColorMenuItem({trackRenderer: trackPair, label: "Unset color"}));

        const trackMenuItems = trackPair.track.menuItemList();
        if(trackMenuItems && trackMenuItems.length > 0) {
            menuItems.push('<hr/>');
            menuItems.push.apply(menuItems, trackMenuItems);
        }


        // const vizWindowTypes = new Set(['alignment', 'annotation', 'variant', 'eqtl', 'snp']);
        // const hasVizWindow = trackRenderer.track.config && trackRenderer.track.config.visibilityWindow !== undefined;
        // if (hasVizWindow || vizWindowTypes.has(trackRenderer.track.config.type)) {
        //     menuItems.push('<hr/>');
        //     menuItems.push(visibilityWindowMenuItem(trackRenderer));
        // }

        if (trackPair.track.removable !== false) {
            menuItems.push('<hr/>');
            menuItems.push(trackRemovalMenuItem(trackPair));
        }

        return menuItems;
    },

    numericDataMenuItems: function (trackPair) {

        const menuItems = [];

        // Data range
        const $e = $('<div>');

        $e.text('Set data range');
        const clickHandler = function () {
            const currentDataRange = trackPair.track.dataRange;
            trackPair.dataRangeDialog.show({
                min: currentDataRange.min || 0,
                max: currentDataRange.max,
            })
        }

        menuItems.push({object: $e, click: clickHandler});

        if (trackPair.track.logScale !== undefined) {
            menuItems.push({
                    object: createCheckbox("Log scale", trackPair.track.logScale),
                    click: () => {
                        trackPair.track.logScale = !trackPair.track.logScale;
                        trackPair.repaintViews();
                    }
                }
            )
        }

        menuItems.push({
                object: createCheckbox("Autoscale", trackPair.track.autoscale),
                click: () => {
                    trackPair.track.autoscale = !trackPair.track.autoscale;
                    trackPair.repaintViews();
                }
            }
        )

        return menuItems;
    }

}


function trackRemovalMenuItem(trackRenderer) {

    var $e, menuClickHandler;
    $e = $('<div>');
    $e.text('Remove track');

    menuClickHandler = function menuClickHandler() {
        var browser = trackRenderer.browser;
        browser.layoutController.removeTrackXYPair(trackRenderer);
    };

    return {object: $e, click: menuClickHandler};

}

function colorPickerMenuItem({trackRenderer, label, option}) {
    var $e,
        clickHandler;

    $e = $('<div>');
    $e.text(label);

    clickHandler = function () {
        trackRenderer.colorPicker.show();
    };

    return {object: $e, click: clickHandler};
}

function unsetColorMenuItem({trackRenderer, label}) {

    const $e = $('<div>');
    $e.text(label);

    return {
        object: $e,
        click: () => {
            trackRenderer.track.color = undefined;
            trackRenderer.repaintViews();
        }
    }
}

function trackRenameMenuItem(trackRenderer) {
    const click = e => {
        const callback = (value) => {
            value = value.trim();
            value = ('' === value || undefined === value) ? 'untitled' : value;
            trackRenderer.setTrackName(value);
        };
        trackRenderer.browser.inputDialog.present({label: 'Track Name', value: trackRenderer.track.name, callback}, e);
    };
    const object = $('<div>');
    object.text('Set track name');
    return {object, click};
}

// function visibilityWindowMenuItem(trackRenderer) {
//
//     const click = e => {
//
//         const callback = () => {
//
//             let value = trackRenderer.browser.inputDialog.input.value
//             value = '' === value || undefined === value ? -1 : value.trim()
//
//             trackRenderer.track.visibilityWindow = Number.parseInt(value);
//             trackRenderer.track.config.visibilityWindow = Number.parseInt(value);
//
//             trackRenderer.updateViews();
//         }
//
//         const config =
//             {
//                 label: 'Visibility Window',
//                 value: (trackRenderer.track.visibilityWindow),
//                 callback
//             }
//         trackRenderer.browser.inputDialog.present(config, e);
//
//     };
//
//     const object = $('<div>');
//     object.text('Set visibility window');
//     return {object, click};
//
// }



export default MenuUtils;
