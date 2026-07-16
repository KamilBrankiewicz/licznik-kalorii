const Barcode = (() => {
  let stream = null;
  let timerId = null;
  let scanning = false;

  function isSupported() {
    return 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async function startCamera(videoEl) {
    if (stream) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (e) {
      throw new Error('CAMERA_DENIED');
    }
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});
  }

  function startDetection(videoEl, onDetected) {
    if (!('BarcodeDetector' in window)) return;
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'code_128']
    });
    scanning = true;
    const tick = async () => {
      if (!scanning) return;
      try {
        const codes = await detector.detect(videoEl);
        if (scanning && codes.length > 0 && codes[0].rawValue) {
          scanning = false;
          onDetected(codes[0].rawValue);
          return;
        }
      } catch (e) {
        // klatka jeszcze niegotowa — próbujemy dalej
      }
      timerId = setTimeout(tick, 180);
    };
    tick();
  }

  function pauseDetection() {
    scanning = false;
    clearTimeout(timerId);
  }

  function stop() {
    pauseDetection();
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  async function fetchProduct(code) {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,nutriments`;
    let response;
    try {
      response = await fetch(url);
    } catch (e) {
      throw new Error('NETWORK_ERROR');
    }

    if (response.status === 404) throw new Error('PRODUCT_NOT_FOUND');
    if (!response.ok) throw new Error('API_ERROR');

    const data = await response.json();
    if (data.status !== 1 || !data.product) throw new Error('PRODUCT_NOT_FOUND');

    const n = data.product.nutriments || {};
    let kcal = n['energy-kcal_100g'];
    if (kcal == null && n['energy_100g'] != null) {
      kcal = Math.round(n['energy_100g'] / 4.184); // kJ -> kcal
    }
    if (kcal == null) throw new Error('NO_NUTRIMENTS');

    return {
      name: data.product.product_name || null,
      per100g: {
        kcal: Number(kcal) || 0,
        protein: Number(n.proteins_100g) || 0,
        carbs: Number(n.carbohydrates_100g) || 0,
        fat: Number(n.fat_100g) || 0
      }
    };
  }

  return { isSupported, startCamera, startDetection, pauseDetection, stop, fetchProduct };
})();
