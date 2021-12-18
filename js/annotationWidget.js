/*
 *  The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,  FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

import {Alert, createColorSwatchSelector} from '../node_modules/igv-ui/dist/igv-ui.js';
import {makeDraggable} from '../node_modules/igv-utils/src/index.js';
import Track2D from './track2D.js'
import HICEvent from './hicEvent.js'
import {Track2DDisplaceModes} from './globals.js'
import $ from '../vendor/jquery-3.3.1.slim.js'

class AnnotationWidget {

    constructor(browser, $container, {title, alertMessage}, trackListRetrievalCallback) {

        this.browser = browser;
        this.trackListRetrievalCallback = trackListRetrievalCallback;

        annotationPresentationButton.call(this, $container, alertMessage);

        annotationPanel.call(this, this.browser.$root, title);

    }

    updateBody(tracks) {

        var self = this,
            trackPairs,

            isTrack2D,
            zi;

        self.$annotationPanel.find('.hic-annotation-row-container').remove();

        isTrack2D = (tracks[0] instanceof Track2D);

        if (isTrack2D) {
            // Reverse list to present layers in "z" order.
            for (zi = tracks.length - 1; zi >= 0; zi--) {
                annotationPanelRow.call(self, self.$annotationPanel, tracks[zi]);
            }
        } else {
            trackPairs = tracks;
            for (let trackRenderer of trackPairs) {
                annotationPanelRow.call(self, self.$annotationPanel, trackRenderer);
            }
        }
    }
}

function annotationPresentationButton($parent, alertMessage) {

    const $button = $parent.find("button");

    $button.on('click', () => {

        const list = this.trackListRetrievalCallback();

        if (list.length > 0) {
            this.updateBody(this.trackListRetrievalCallback());
            this.$annotationPanel.toggle();
        } else {
            Alert.presentAlert(alertMessage);
        }

        this.browser.hideMenu();
    });
}

function annotationPanel($parent, title) {

    var self = this,
        $panel_header,
        $load_container,
        $div,
        $fa;

    this.$annotationPanel = $('<div>', {class: 'hic-annotation-panel-container'});
    $parent.append(this.$annotationPanel);

    // close button container
    $panel_header = $('<div>', {class: 'hic-annotation-panel-header'});
    this.$annotationPanel.append($panel_header);

    // panel title
    $div = $('<div>');
    $div.text(title);
    $panel_header.append($div);

    // close button
    $div = $('<div>', {class: 'hic-menu-close-button'});
    $panel_header.append($div);

    $fa = $("<i>", {class: 'fa fa-times'});
    $div.append($fa);

    $fa.on('click', function (e) {
        self.$annotationPanel.toggle();
    });

    // TODO: Continue changes for load functions added to side panel
    // load container
    // $load_container = $('<div>', { class:'hic-annotation-panel-load-container' });
    // this.$annotationPanel.append($load_container);
    //
    // // Load
    // $div = $('<div>');
    // $load_container.append($div);
    // $div.text('Load:');
    //
    // // Blah
    // $div = $('<div>');
    // $load_container.append($div);
    // $div.text('Blah');

    //this.$annotationPanel.draggable();
    makeDraggable(this.$annotationPanel.get(0), $panel_header.get(0));
    this.$annotationPanel.hide();
}

function annotationPanelRow($container, track) {
    var self = this,
        $colorpickerContainer,
        $colorpickerButton,
        $colorpicker,
        $row_container,
        $row,
        $hideShowTrack,
        $deleteTrack,
        $upTrack,
        $downTrack,
        $e,
        $o,
        hidden_color = '#f7f7f7',
        str,
        isTrack2D,
        trackList,
        xyTrackRendererPair,
        trackRenderer,
        track1D,
        index,
        upp,
        dwn;

    isTrack2D = (track instanceof Track2D);
    trackList = this.trackListRetrievalCallback();

    if (false === isTrack2D) {
        xyTrackRendererPair = track;
        track1D = xyTrackRendererPair.x.track;
        trackRenderer = xyTrackRendererPair.x.track.trackView;
    }

    // row container
    $row_container = $('<div>', {class: 'hic-annotation-row-container'});
    $container.append($row_container);

    // one row
    $row = $('<div>', {class: 'hic-annotation-modal-row'});
    $row_container.append($row);

    // track name
    $e = $("<div>");
    $e.text(isTrack2D ? track.config.name : track1D.config.name);
    $row.append($e);

    // track hide/show
    if (isTrack2D) {
        str = (true === track.isVisible) ? 'fa fa-eye fa-lg' : 'fa fa-eye-slash fa-lg';
        $hideShowTrack = $("<i>", {class: str, 'aria-hidden': 'true'});
        $row.append($hideShowTrack);
        $hideShowTrack.on('click', function (e) {

            if ($hideShowTrack.hasClass('fa-eye')) {
                $hideShowTrack.addClass('fa-eye-slash');
                $hideShowTrack.removeClass('fa-eye');
                track.isVisible = false;
            } else {
                $hideShowTrack.addClass('fa-eye');
                $hideShowTrack.removeClass('fa-eye-slash');
                track.isVisible = true;
            }

            self.browser.contactMatrixView.clearImageCaches();
            self.browser.contactMatrixView.update();

        });
    }

    if (isTrack2D) {

        // matrix diagonal widget
        const $matrix_diagonal_div = $('<div>', {class: 'matrix-diagonal-widget-container matrix-diagonal-widget-all'});
        $row.append($matrix_diagonal_div);
        $matrix_diagonal_div.on('click.matrix_diagonal_div', (e) => {
            e.preventDefault();
            matrixDiagionalWidgetHandler($matrix_diagonal_div, track);
        });

    }

    // color swatch selector button
    $colorpickerButton = annotationColorSwatch(isTrack2D ? track.getColor() : track1D.color);
    $row.append($colorpickerButton);

    // color swatch selector
    $colorpickerContainer = createAnnotationPanelColorpickerContainer($row_container, {width: ((29 * 24) + 1 + 1)}, function () {
        $row.next('.hic-color-swatch-container').toggle();
    });

    $colorpickerButton.on('click', function (e) {
        $row.next('.hic-color-swatch-container').toggle();
    });

    $colorpickerContainer.hide();

    const colorHandler = color => {

        var $swatch;

        $swatch = $row.find('.fa-square');
        $swatch.css({'color': color});

        if (isTrack2D) {
            track.color = color;
            self.browser.eventBus.post(HICEvent('TrackState2D', track));
        } else {
            trackRenderer.setColor(color);
        }

    }

    createColorSwatchSelector($colorpickerContainer.get(0), colorHandler);


    // track up/down
    $e = $('<div>', {class: 'up-down-arrow-container'});
    $row.append($e);

    $upTrack = $("<i>", {class: 'fa fa-arrow-up', 'aria-hidden': 'true'});
    $e.append($upTrack);

    $downTrack = $("<i>", {class: 'fa fa-arrow-down', 'aria-hidden': 'true'});
    $e.append($downTrack);

    if (1 === trackList.length) {
        $upTrack.css('color', hidden_color);
        $downTrack.css('color', hidden_color);
    } else if (track === trackList[0]) {
        $o = isTrack2D ? $downTrack : $upTrack;
        $o.css('color', hidden_color);
    } else if (track === trackList[trackList.length - 1]) {
        $o = isTrack2D ? $upTrack : $downTrack;
        $o.css('color', hidden_color);
    }

    index = trackList.indexOf(track);

    upp = function (e) {

        track = trackList[(index + 1)];
        trackList[(index + 1)] = trackList[index];
        trackList[index] = track;
        if (isTrack2D) {
            self.browser.eventBus.post(HICEvent('TrackState2D', trackList));
            self.updateBody(trackList);
        } else {
            self.browser.updateLayout();
            self.updateBody(trackList);
        }
    };

    dwn = function (e) {

        track = trackList[(index - 1)];
        trackList[(index - 1)] = trackList[index];
        trackList[index] = track;
        if (isTrack2D) {
            self.browser.eventBus.post(HICEvent('TrackState2D', trackList));
            self.updateBody(trackList);
        } else {
            self.browser.updateLayout();
            self.updateBody(trackList);
        }
    };

    $upTrack.on('click', isTrack2D ? upp : dwn);

    $downTrack.on('click', isTrack2D ? dwn : upp);


    // track delete
    $deleteTrack = $("<i>", {class: 'fa fa-trash-o fa-lg', 'aria-hidden': 'true'});
    $row.append($deleteTrack);
    $deleteTrack.on('click', function (e) {
        var index;

        if (isTrack2D) {

            index = trackList.indexOf(track);

            trackList.splice(index, 1);

            self.browser.contactMatrixView.clearImageCaches();
            self.browser.contactMatrixView.update();

            self.browser.eventBus.post(HICEvent('TrackLoad2D', trackList));
        } else {
            self.browser.layoutController.removeTrackXYPair(trackRenderer.trackRenderPair);
        }

        self.updateBody(trackList);
    });
}

function matrixDiagionalWidgetHandler($icon, track2D) {

    if ($icon.hasClass('matrix-diagonal-widget-all')) {

        $icon.removeClass('matrix-diagonal-widget-all');

        $icon.addClass('matrix-diagonal-widget-lower');
        track2D.displayMode = Track2DDisplaceModes.displayLowerMatrix;
    } else if ($icon.hasClass('matrix-diagonal-widget-lower')) {

        $icon.removeClass('matrix-diagonal-widget-lower');

        $icon.addClass('matrix-diagonal-widget-upper');
        track2D.displayMode = Track2DDisplaceModes.displayUpperMatrix;
    } else if ($icon.hasClass('matrix-diagonal-widget-upper')) {

        $icon.removeClass('matrix-diagonal-widget-upper');

        $icon.addClass('matrix-diagonal-widget-all');
        track2D.displayMode = Track2DDisplaceModes.displayAllMatrix;
    } else {

        $icon.addClass('matrix-diagonal-widget-all');
        track2D.displayMode = Track2DDisplaceModes.displayAllMatrix;
    }
}

function annotationColorSwatch(rgbString) {
    var $swatch,
        $fa;

    $swatch = $('<div>', {class: 'igv-color-swatch'});

    $fa = $('<i>', {class: 'fa fa-square fa-lg', 'aria-hidden': 'true'});
    $swatch.append($fa);

    $fa.css({color: rgbString});

    return $swatch;
}

function createAnnotationPanelColorpickerContainer($parent, config, closeHandler) {

    var $container,
        $header,
        $fa;

    $container = $('<div>', {class: 'hic-color-swatch-container'});
    $parent.append($container);

    // width
    if (config && config.width) {
        $container.width(config.width);
    }

    // height
    if (config && config.height) {
        $container.height(config.height);
    }

    // header
    $header = $('<div>');
    $container.append($header);

    // close button
    $fa = $("<i>", {class: 'fa fa-times'});
    $header.append($fa);

    $fa.on('click', function (e) {
        closeHandler();
    });

    return $container;
}


export default AnnotationWidget
