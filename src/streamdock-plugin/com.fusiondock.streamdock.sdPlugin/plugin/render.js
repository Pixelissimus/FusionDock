/*
 * Draws key images.
 *
 * The N1's keys are 96x96. Icons come from the user's own Fusion install, served by the
 * add-in over HTTP -- Autodesk's artwork is never bundled with this plugin.
 *
 * Elgato's own icon guidance is to leave room at the bottom for a label, and the user
 * research says people want icon AND text (they forget bindings otherwise). So: glyph in
 * the upper area, label across the bottom.
 */
(function (root) {
  'use strict';

  var KEY_SIZE = 96;
  var LABEL_HEIGHT = 22;
  var BACKGROUND = '#1c1c1e';
  var LABEL_COLOUR = '#f2f2f7';
  var DISABLED_ALPHA = 0.35;

  var imageCache = {};

  function loadImage(url) {
    if (imageCache[url]) {
      return imageCache[url];
    }
    var promise = new Promise(function (resolve) {
      var image = new Image();
      // The add-in is a different origin; without this the canvas is tainted and
      // toDataURL() throws.
      image.crossOrigin = 'anonymous';
      image.onload = function () { resolve(image); };
      // A missing icon is normal (not every command has one, and resourceFolder raises
      // for some). Resolve null and let the caller fall back to a text-only key.
      image.onerror = function () { resolve(null); };
      image.src = url;
    });
    imageCache[url] = promise;
    return promise;
  }

  function clearCache() {
    imageCache = {};
  }

  function fitFont(context, text, maxWidth, startSize) {
    var size = startSize;
    context.font = '600 ' + size + 'px "Segoe UI", system-ui, sans-serif';
    while (size > 8 && context.measureText(text).width > maxWidth) {
      size -= 1;
      context.font = '600 ' + size + 'px "Segoe UI", system-ui, sans-serif';
    }
    return size;
  }

  /*
   * spec: { label, iconUrl, accent, disabled, badge, rotation }
   * rotation is degrees; the host does not rotate key images for us, so landscape keys are
   * pre-rotated here.
   */
  function renderKey(spec) {
    var canvas = document.createElement('canvas');
    canvas.width = KEY_SIZE;
    canvas.height = KEY_SIZE;
    var context = canvas.getContext('2d');

    return loadImage(spec.iconUrl || '').then(function (image) {
      context.save();

      if (spec.rotation) {
        context.translate(KEY_SIZE / 2, KEY_SIZE / 2);
        context.rotate((spec.rotation * Math.PI) / 180);
        context.translate(-KEY_SIZE / 2, -KEY_SIZE / 2);
      }

      context.fillStyle = spec.accent || BACKGROUND;
      context.fillRect(0, 0, KEY_SIZE, KEY_SIZE);

      if (spec.disabled) {
        context.globalAlpha = DISABLED_ALPHA;
      }

      var label = spec.label || '';
      var glyphArea = label ? KEY_SIZE - LABEL_HEIGHT : KEY_SIZE;
      var labelDrawn = false;

      if (image) {
        // Fusion's icons are small (16-64px). Scale up to fill most of the glyph area but
        // keep aspect ratio, and never exceed the area so nothing is clipped.
        var target = Math.min(glyphArea - 12, KEY_SIZE - 20);
        var scale = Math.min(target / image.width, target / image.height);
        var width = image.width * scale;
        var height = image.height * scale;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(
          image,
          (KEY_SIZE - width) / 2,
          (glyphArea - height) / 2,
          width,
          height
        );
      } else if (label) {
        // No icon: the label becomes the glyph, wrapped onto two lines if it fits better.
        context.fillStyle = LABEL_COLOUR;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        var words = label.split(' ');
        if (words.length > 1) {
          var firstLine = words.slice(0, Math.ceil(words.length / 2)).join(' ');
          var secondLine = words.slice(Math.ceil(words.length / 2)).join(' ');
          fitFont(context, firstLine, KEY_SIZE - 12, 18);
          context.fillText(firstLine, KEY_SIZE / 2, KEY_SIZE / 2 - 11);
          fitFont(context, secondLine, KEY_SIZE - 12, 18);
          context.fillText(secondLine, KEY_SIZE / 2, KEY_SIZE / 2 + 11);
        } else {
          fitFont(context, label, KEY_SIZE - 12, 20);
          context.fillText(label, KEY_SIZE / 2, KEY_SIZE / 2);
        }
        // Deliberately no early return here: a folder with no icon still needs its badge,
        // or a placeholder folder key is indistinguishable from an ordinary text key.
        labelDrawn = true;
      }

      if (label && !labelDrawn) {
        context.globalAlpha = spec.disabled ? DISABLED_ALPHA : 1;
        context.fillStyle = LABEL_COLOUR;
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        fitFont(context, label, KEY_SIZE - 8, 15);
        context.fillText(label, KEY_SIZE / 2, KEY_SIZE - 5);
      }

      // Small corner dot marking a key that opens a sub-page, so a folder is
      // distinguishable from a command at a glance.
      if (spec.badge) {
        context.globalAlpha = 1;
        context.fillStyle = '#4a9eff';
        context.beginPath();
        context.arc(KEY_SIZE - 10, 10, 4, 0, Math.PI * 2);
        context.fill();
      }

      context.restore();
      return canvas.toDataURL('image/png');
    });
  }

  function blankKey(rotation) {
    return renderKey({ label: '', iconUrl: '', rotation: rotation });
  }

  var api = {
    KEY_SIZE: KEY_SIZE,
    renderKey: renderKey,
    blankKey: blankKey,
    clearCache: clearCache
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.FsdRender = api;
  }
}(typeof self !== 'undefined' ? self : this));
