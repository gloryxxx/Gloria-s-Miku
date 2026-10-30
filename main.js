import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 2));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(3, 6, 8);
scene.add(keyLight);

let modelSize = null;
let vrm = null;
let mixer = null;
let previousFrameTime = performance.now();

const chat = document.getElementById('chat');
const chatForm = document.getElementById('chat-form');
const questionInput = document.getElementById('question');
const messages = document.getElementById('messages');
const sendButton = document.getElementById('send');
const chatToggle = document.getElementById('chat-toggle');
const modeButtons = document.querySelectorAll('.mode-button');

function setActiveMode(mode) {
  modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  const isTextMode = mode === 'text';
  chatForm.style.display = isTextMode ? 'flex' : 'none';
  messages.style.display = isTextMode ? 'block' : 'none';

  if (isTextMode && window.innerWidth <= 700) {
    chat.classList.add('is-open');
  } else {
    chat.classList.remove('is-open');
  }
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => setActiveMode(button.dataset.mode));
});

function updateChatMode() {
  if (window.innerWidth > 700) {
    chat.classList.remove('is-open');
  }
}

chatToggle.addEventListener('click', () => {
  if (window.innerWidth <= 700) {
    chat.classList.toggle('is-open');
  }
});

window.addEventListener('resize', updateChatMode);
setActiveMode('text');
updateChatMode();

function fitCameraToModel() {
  if (!modelSize) return;

  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const radius = modelSize.length() / 2;
  const distance = (radius / Math.sin(limitingFov / 2)) * 1.1;

  camera.position.set(0, 0, distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 10;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function parseBinaryAsset(loader, url) {
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Asset request failed (${response.status}): ${url}`);
      }
      return response.arrayBuffer();
    })
    .then((data) => new Promise((resolve, reject) => {
      loader.parse(data, '/miku/', resolve, reject);
    }));
}

async function loadModelAndIdle() {
  const modelLoader = new GLTFLoader();
  modelLoader.register((parser) => new VRMLoaderPlugin(parser));

  const modelGltf = await parseBinaryAsset(modelLoader, '/miku/Miku4.vrm');
  vrm = modelGltf.userData.vrm;

  if (!vrm) {
    throw new Error('Miku4.vrm did not contain a VRM avatar.');
  }

  VRMUtils.rotateVRM0(vrm);

  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  const center = bounds.getCenter(new THREE.Vector3());
  modelSize = bounds.getSize(new THREE.Vector3());

  vrm.scene.position.sub(center);
  scene.add(vrm.scene);
  fitCameraToModel();

  const animationLoader = new GLTFLoader();
  animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  const animationGltf = await parseBinaryAsset(animationLoader, '/miku/idle.vrma');
  const vrmAnimation = animationGltf.userData.vrmAnimations?.[0];

  if (!vrmAnimation) {
    throw new Error('idle.vrma did not contain a VRM animation.');
  }

  mixer = new THREE.AnimationMixer(vrm.scene);
  mixer.clipAction(createVRMAnimationClip(vrmAnimation, vrm)).play();
}

function advanceAnimation() {
  const now = performance.now();
  const delta = Math.min((now - previousFrameTime) / 1000, 0.05);
  previousFrameTime = now;

  mixer?.update(delta);
  vrm?.update(delta);
  renderer.render(scene, camera);
}

function resizeRenderer() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCameraToModel();
  renderer.render(scene, camera);
}

function addMessage(text, className) {
  const message = document.createElement('div');
  message.className = className;
  message.textContent = text;

  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const question = questionInput.value.trim();
  if (!question) return;

  addMessage(`You: ${question}`, 'user-message');

  questionInput.value = '';
  sendButton.disabled = true;
  sendButton.textContent = '...';

  try {
    const response = await fetch('/api/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    addMessage(`Miku: ${data.answer}`, 'ai-message');
  } catch (error) {
    console.error(error);
    addMessage('Miku: Sorry, something went wrong!', 'ai-message');
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = 'Send';
    questionInput.focus();
  }
}

renderer.setAnimationLoop(advanceAnimation);
window.addEventListener('resize', resizeRenderer);
resizeRenderer();

chatForm.addEventListener('submit', handleFormSubmit);

loadModelAndIdle().catch((error) => {
  console.error('Could not load Miku and idle animation:', error);
});
