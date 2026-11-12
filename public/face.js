// Shared in-browser face recognition helpers (face-api.js, models from CDN). No image ever leaves the browser.
const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
let _faceReady = null;
function loadFaceApi() {
  if (_faceReady) return _faceReady;
  _faceReady = new Promise((resolve, reject) => {
    const go = async () => {
      try {
        await faceapi.tf.ready();
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL)
        ]);
        resolve(faceapi);
      } catch (e) { _faceReady = null; reject(e); }
    };
    if (window.faceapi) return go();
    const s = document.createElement('script');
    s.src = FACE_API_URL; s.onload = go; s.onerror = () => { _faceReady = null; reject(new Error('Could not load face recognition library')); };
    document.head.appendChild(s);
  });
  return _faceReady;
}
let _stream = null;
async function startCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera needs HTTPS (or localhost) and a supported browser');
  _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  video.srcObject = _stream;
  await video.play();
}
function stopCamera() { if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; } }
// Returns { descriptor: Float32Array(128), score } for the single most prominent face, or null.
async function readFace(video, inputSize = 320) {
  const r = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 }))
    .withFaceLandmarks().withFaceDescriptor();
  return r ? { descriptor: r.descriptor, score: r.detection.score } : null;
}
function euclid(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
