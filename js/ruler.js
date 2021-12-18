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


/**
 * @author Jim Robinson
 */

import {IGVColor, IGVMath} from '../node_modules/igv-utils/src/index.js'
import IGVGraphics from "./igv/igv-canvas.js"
import $ from '../vendor/jquery-3.3.1.slim.js'

function randomRGB(min, max) {

    min = IGVMath.clamp(min, 0, 255)
    max = IGVMath.clamp(max, 0, 255)

    const r = Math.round(Math.random() * (max - min) + min).toString(10)
    const g = Math.round(Math.random() * (max - min) + min).toString(10)
    const b = Math.round(Math.random() * (max - min) + min).toString(10)
    return `rgb(${r},${g},${b})`

}

class Ruler {

    constructor(browser, $parent, axis) {

        this.browser = browser;
        this.axis = axis;

        this.$axis = $parent.find(`div[id$='-axis']`);

        this.$canvas = $parent.find("canvas");

        this.ctx = this.$canvas.get(0).getContext("2d");
        this.ctx.canvas.width = this.$axis.width();
        this.ctx.canvas.height = this.$axis.height();

        this.$wholeGenomeContainer = $parent.find("div[id$='-axis-whole-genome-container']");

        this.yAxisTransformWithContext = ctx => {
            ctx.scale(-1, 1);
            ctx.rotate(Math.PI / 2.0);
        };

        this.setAxisTransform(axis);

        browser.eventBus.subscribe('MapLoad', this);
        browser.eventBus.subscribe("UpdateContactMapMousePosition", this);

    }

    wholeGenomeLayout($axis, $wholeGenomeContainer, axisName, dataset) {

        var self = this,
            list,
            dimen,
            extent,
            scraps,
            $div,
            $firstDiv;

        // discard current tiles
        $wholeGenomeContainer.empty();

        list = dataset.chromosomes.filter(function (chromosome) {
            return 'all' !== chromosome.name.toLowerCase();
        });

        extent = 0;    // could use reduce for this
        list.forEach(function (chromosome) {
            extent += chromosome.size;
        });

        dimen = 'x' === axisName ? $axis.width() : $axis.height();

        scraps = 0;
        this.bboxes = [];
        $firstDiv = undefined;

        list.forEach(function (chr) {
            var size,
                percentage;

            percentage = (chr.bpLength) / extent;

            if (percentage * dimen < 1.0) {
                scraps += percentage;
            } else {

                $div = $("<div>", { class: `${ self.axis }-axis-whole-genome-chromosome-container` });
                $wholeGenomeContainer.append($div);
                $div.data('label', chr.name);

                // debug
                // $div.get(0).style.backgroundColor = randomRGB(150, 250);

                if (!$firstDiv) {
                    $firstDiv = $div;
                }

                if ('x' === axisName) {
                    size = Math.round(percentage * dimen);
                    $div.width(size);
                } else {
                    size = Math.round(percentage * dimen);
                    $div.height(size);
                }

                // border
                const $border = $('<div>');
                $div.append($border);

                // label
                const $label = $('<div>');
                $border.append($label);

                $label.text($div.data('label'));
                $label.get(0).title = $div.data('label');

                decorate.call(self, $div);
            }

        });

        scraps *= dimen;
        scraps = Math.floor(scraps);
        if (scraps >= 1) {

            const className = self.axis + '-axis-whole-genome-chromosome-container';
            $div = $("<div>", {class: className});
            $wholeGenomeContainer.append($div);
            $div.data('label', '-');

            $div.width(scraps);

            // className = self.axis + '-axis-whole-genome-chromosome';
            // $e = $("<div>", {class: className});
            // $div.append($e);
            // $e.text($div.data('label'));

            decorate.call(self, $div);
        }

        $wholeGenomeContainer.children().each(function (index) {
            self.bboxes.push(bbox(axisName, $(this), $firstDiv));
        });


        // initially hide
        this.hideWholeGenome();

        function decorate($d) {
            var self = this;

            $d.on('click', function (e) {
                var $o;
                $o = $(this).first();
                self.browser.parseGotoInput($o.text());

                self.unhighlightWholeChromosome();
                self.otherRuler.unhighlightWholeChromosome();
            });

            $d.hover(
                function () {
                    hoverHandler.call(self, $(this), true);
                },

                function () {
                    hoverHandler.call(self, $(this), false);
                }
            );

        }

        function hoverHandler($e, doHover) {

            var target,
                $target;

            target = $e.data('label');

            this.otherRuler.$wholeGenomeContainer.children().each(function (index) {
                if (target === $(this).data('label')) {
                    $target = $(this);
                }
            });

            if (true === doHover) {
                $e.addClass('hic-whole-genome-chromosome-highlight');
                $target.addClass('hic-whole-genome-chromosome-highlight');
            } else {
                $e.removeClass('hic-whole-genome-chromosome-highlight');
                $target.removeClass('hic-whole-genome-chromosome-highlight');
            }
        }

    };

    hideWholeGenome() {
        this.$wholeGenomeContainer.hide();
        this.$canvas.show();
    };

    showWholeGenome() {
        this.$canvas.hide();
        this.$wholeGenomeContainer.show();
    };

    setAxisTransform(axis) {

        this.canvasTransform = ('y' === axis) ? this.yAxisTransformWithContext : identityTransformWithContext;

        this.labelReflectionTransform = ('y' === axis) ? reflectionTransformWithContext : function (context, exe) {
        };

    };

    unhighlightWholeChromosome() {
        this.$wholeGenomeContainer.children().removeClass('hic-whole-genome-chromosome-highlight');
    };

    receiveEvent(event) {
        var offset,
            $e;

        if ('MapLoad' === event.type) {
            this.wholeGenomeLayout(this.$axis, this.$wholeGenomeContainer, this.axis, event.data);
            this.update();
        } else if ('UpdateContactMapMousePosition' === event.type) {

            if (this.bboxes) {
                this.unhighlightWholeChromosome();
                offset = 'x' === this.axis ? event.data.x : event.data.y;
                $e = hitTest(this.bboxes, offset);
                if ($e) {
                    // console.log(this.axis + ' highlight chr ' + $e.text());
                    $e.addClass('hic-whole-genome-chromosome-highlight');
                }
            }
        }

    };

    locusChange(event) {

        this.update();

    };

    updateWidthWithCalculation(calc) {

        this.$axis.css('width', calc);

        this.$canvas.width(this.$axis.width());
        this.$canvas.attr('width', this.$axis.width());

        this.wholeGenomeLayout(this.$axis, this.$wholeGenomeContainer, this.axis, this.browser.dataset);

        this.update();
    };

    updateHeight(height) {

        this.$canvas.height(height);
        this.$canvas.attr('height', height);

        this.wholeGenomeLayout(this.$axis, this.$wholeGenomeContainer, this.axis, this.browser.dataset);

        this.update();
    };

    update() {

        var w,
            h,
            bin,
            config = {},
            browser = this.browser;

        if (browser.dataset.isWholeGenome(browser.state.chr1)) {
            this.showWholeGenome();
            return;
        }

        this.hideWholeGenome();

        identityTransformWithContext(this.ctx);
        IGVGraphics.fillRect(this.ctx, 0, 0, this.$canvas.width(), this.$canvas.height(), {fillStyle: IGVColor.rgbColor(255, 255, 255)});

        this.canvasTransform(this.ctx);

        w = ('x' === this.axis) ? this.$canvas.width() : this.$canvas.height();
        h = ('x' === this.axis) ? this.$canvas.height() : this.$canvas.width();

        IGVGraphics.fillRect(this.ctx, 0, 0, w, h, {fillStyle: IGVColor.rgbColor(255, 255, 255)});

        config.bpPerPixel = browser.dataset.bpResolutions[browser.state.zoom] / browser.state.pixelSize;

        bin = ('x' === this.axis) ? browser.state.x : browser.state.y;
        config.bpStart = bin * browser.dataset.bpResolutions[browser.state.zoom];

        config.rulerTickMarkReferencePixels = Math.max(Math.max(this.$canvas.width(), this.$canvas.height()), Math.max(this.$otherRulerCanvas.width(), this.$otherRulerCanvas.height()));

        config.rulerLengthPixels = w;
        config.rulerHeightPixels = h;

        config.height = Math.min(this.$canvas.width(), this.$canvas.height());

        this.draw(config);
    };

    draw(options) {

        var self = this,
            fontStyle,
            tickSpec,
            majorTickSpacing,
            nTick,
            pixelLast,
            pixel,
            tickSpacingPixels,
            labelWidthPixels,
            modulo,
            l,
            yShim,
            tickHeight,
            rulerLabel,
            chrSize,
            chrName,
            chromosomes = this.browser.dataset.chromosomes;

        chrName = ('x' === this.axis) ? chromosomes[this.browser.state.chr1].name : chromosomes[this.browser.state.chr2].name;
        chrSize = ('x' === this.axis) ? chromosomes[this.browser.state.chr1].size : chromosomes[this.browser.state.chr2].size;

        if (options.chrName === "all") {

        } else {

            IGVGraphics.fillRect(this.ctx, 0, 0, options.rulerLengthPixels, options.rulerHeightPixels, {fillStyle: IGVColor.rgbColor(255, 255, 255)});

            fontStyle = {
                textAlign: 'center',
                font: '9px PT Sans',
                fillStyle: "rgba(64, 64, 64, 1)",
                strokeStyle: "rgba(64, 64, 64, 1)"
            };

            tickSpec = findSpacing(Math.floor(options.rulerTickMarkReferencePixels * options.bpPerPixel));
            majorTickSpacing = tickSpec.majorTick;

            // Find starting point closest to the current origin
            nTick = Math.floor(options.bpStart / majorTickSpacing) - 1;

            pixel = pixelLast = 0;

            IGVGraphics.setProperties(this.ctx, fontStyle);
            this.ctx.lineWidth = 1.0;

            yShim = 1;
            tickHeight = 8;
            while (pixel < options.rulerLengthPixels) {

                l = Math.floor(nTick * majorTickSpacing);

                pixel = Math.round(((l - 1) - options.bpStart + 0.5) / options.bpPerPixel);

                rulerLabel = formatNumber(l / tickSpec.unitMultiplier, 0) + " " + tickSpec.majorUnit;

                tickSpacingPixels = Math.abs(pixel - pixelLast);
                labelWidthPixels = this.ctx.measureText(rulerLabel).width;

                if (labelWidthPixels > tickSpacingPixels) {

                    if (tickSpacingPixels < 32) {
                        modulo = 4;
                    } else {
                        modulo = 2;
                    }
                } else {
                    modulo = 1;
                }

                // modulo = 1;
                if (0 === nTick % modulo) {

                    if (Math.floor((pixel * options.bpPerPixel) + options.bpStart) < chrSize) {

                        // console.log('   label delta(' + Math.abs(pixel - pixelLast) + ') modulo(' + modulo + ') bpp(' + options.bpPerPixel + ')');

                        this.ctx.save();
                        this.labelReflectionTransform(this.ctx, pixel);
                        IGVGraphics.fillText(this.ctx, rulerLabel, pixel, options.height - (tickHeight / 0.75));
                        this.ctx.restore();

                    }

                } else {
                    // console.log('no label');
                }

                if (Math.floor((pixel * options.bpPerPixel) + options.bpStart) < chrSize) {
                    IGVGraphics.strokeLine(this.ctx,
                        pixel, options.height - tickHeight,
                        pixel, options.height - yShim);
                }

                pixelLast = pixel;
                nTick++;

            } // while (pixel < options.rulerLengthPixels)

            IGVGraphics.strokeLine(this.ctx, 0, options.height - yShim, options.rulerLengthPixels, options.height - yShim);

        }

        function formatNumber(anynum, decimal) {
            //decimal  - the number of decimals after the digit from 0 to 3
            //-- Returns the passed number as a string in the xxx,xxx.xx format.
            //anynum = eval(obj.value);
            var divider = 10;
            switch (decimal) {
                case 0:
                    divider = 1;
                    break;
                case 1:
                    divider = 10;
                    break;
                case 2:
                    divider = 100;
                    break;
                default:       //for 3 decimal places
                    divider = 1000;
            }

            var workNum = Math.abs((Math.round(anynum * divider) / divider));

            var workStr = "" + workNum;

            if (-1 === workStr.indexOf(".")) {
                workStr += "."
            }

            var dStr = workStr.substr(0, workStr.indexOf("."));
            var dNum = dStr - 0;
            var pStr = workStr.substr(workStr.indexOf("."));

            while (pStr.length - 1 < decimal) {
                pStr += "0"
            }

            if ('.' === pStr) {
                pStr = '';
            }

            //--- Adds a comma in the thousands place.
            if (dNum >= 1000) {
                var dLen = dStr.length;
                dStr = parseInt("" + (dNum / 1000)) + "," + dStr.substring(dLen - 3, dLen)
            }

            //-- Adds a comma in the millions place.
            if (dNum >= 1000000) {
                dLen = dStr.length;
                dStr = parseInt("" + (dNum / 1000000)) + "," + dStr.substring(dLen - 7, dLen)
            }
            var retval = dStr + pStr;
            //-- Put numbers in parentheses if negative.
            if (anynum < 0) {
                retval = "(" + retval + ")";
            }

            //You could include a dollar sign in the return value.
            //retval =  "$"+retval
            return retval;
        }
    };
}

function bbox(axis, $child, $firstChild) {
    var delta,
        size,
        o,
        fo;

    o = 'x' === axis ? $child.offset().left : $child.offset().top;
    fo = 'x' === axis ? $firstChild.offset().left : $firstChild.offset().top;

    delta = o - fo;
    size = 'x' === axis ? $child.width() : $child.height();

    return {$e: $child, a: delta, b: delta + size};

}

function hitTest(bboxes, value) {
    var $result,
        success;

    success = false;
    $result = undefined;
    bboxes.forEach(function (bbox) {

        if (false === success) {

            if (value < bbox.a) {
                // nuthin
            } else if (value > bbox.b) {
                // nuthin
            } else {
                $result = bbox.$e;
                success = true;
            }

        }

    });

    return $result;
}


function TickSpacing(majorTick, majorUnit, unitMultiplier) {
    this.majorTick = majorTick;
    this.majorUnit = majorUnit;
    this.unitMultiplier = unitMultiplier;
}

function findSpacing(rulerLengthBP) {

    if (rulerLengthBP < 10) {
        return new TickSpacing(1, "", 1);
    }


    // How many zeroes?
    var nZeroes = Math.floor(log10(rulerLengthBP));
    var majorUnit = "";
    var unitMultiplier = 1;
    if (nZeroes > 9) {
        majorUnit = "gb";
        unitMultiplier = 1000000000;
    }
    if (nZeroes > 6) {
        majorUnit = "mb";
        unitMultiplier = 1000000;
    } else if (nZeroes > 3) {
        majorUnit = "kb";
        unitMultiplier = 1000;
    }

    var nMajorTicks = rulerLengthBP / Math.pow(10, nZeroes - 1);
    if (nMajorTicks < 25) {
        return new TickSpacing(Math.pow(10, nZeroes - 1), majorUnit, unitMultiplier);
    } else {
        return new TickSpacing(Math.pow(10, nZeroes) / 2, majorUnit, unitMultiplier);
    }

    function log10(x) {
        var dn = Math.log(10);
        return Math.log(x) / dn;
    }
}

function reflectionTransformWithContext(context, exe) {
    context.translate(exe, 0);
    context.scale(-1, 1);
    context.translate(-exe, 0);
}

function identityTransformWithContext(context) {
    // 3x2 matrix. column major. (sx 0 0 sy tx ty).
    context.setTransform(1, 0, 0, 1, 0, 0);
}

export default Ruler;
