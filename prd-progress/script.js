(function () {
  "use strict";

  var frame = document.getElementById("schemaFrame");
  var canvas = document.getElementById("schemaCanvas");
  var pctLabel = document.getElementById("schemaZoomPct");
  var btnIn = document.getElementById("schemaZoomIn");
  var btnOut = document.getElementById("schemaZoomOut");
  var btnReset = document.getElementById("schemaZoomReset");

  if (!frame || !canvas) return;

  var MIN_SCALE = 0.2;
  var MAX_SCALE = 4;
  var scale = 1;

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function render() {
    canvas.style.transform = "scale(" + scale + ")";
    if (pctLabel) pctLabel.textContent = Math.round(scale * 100) + "%";
  }

  // Zoom while keeping the point under (clientX, clientY) visually fixed.
  function zoomTo(newScale, clientX, clientY) {
    newScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
    if (newScale === scale) return;

    var rect = frame.getBoundingClientRect();
    var anchorX = clientX - rect.left + frame.scrollLeft;
    var anchorY = clientY - rect.top + frame.scrollTop;
    var ratio = newScale / scale;

    scale = newScale;
    render();

    frame.scrollLeft = anchorX * ratio - (clientX - rect.left);
    frame.scrollTop = anchorY * ratio - (clientY - rect.top);
  }

  function zoomAtCenter(newScale) {
    var rect = frame.getBoundingClientRect();
    zoomTo(newScale, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // Mouse wheel = zoom (no modifier key needed); panning is via drag or scrollbars.
  frame.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomTo(scale * factor, e.clientX, e.clientY);
    },
    { passive: false },
  );

  // Click-and-drag panning (matches the grab/grabbing cursor set in CSS).
  var isDragging = false;
  var dragStartX = 0;
  var dragStartY = 0;
  var scrollStartX = 0;
  var scrollStartY = 0;

  frame.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    scrollStartX = frame.scrollLeft;
    scrollStartY = frame.scrollTop;
    frame.classList.add("grabbing");
  });

  window.addEventListener("mousemove", function (e) {
    if (!isDragging) return;
    frame.scrollLeft = scrollStartX - (e.clientX - dragStartX);
    frame.scrollTop = scrollStartY - (e.clientY - dragStartY);
  });

  window.addEventListener("mouseup", function () {
    if (!isDragging) return;
    isDragging = false;
    frame.classList.remove("grabbing");
  });

  if (btnIn) {
    btnIn.addEventListener("click", function () {
      zoomAtCenter(scale * 1.25);
    });
  }
  if (btnOut) {
    btnOut.addEventListener("click", function () {
      zoomAtCenter(scale / 1.25);
    });
  }
  if (btnReset) {
    btnReset.addEventListener("click", function () {
      scale = 1;
      render();
      frame.scrollLeft = 0;
      frame.scrollTop = 0;
    });
  }

  render();
})();
