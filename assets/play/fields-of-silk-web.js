/* Browser controls for the original Fields of Silk cartridge. */
'use strict';

const gameScreen = document.getElementById('screen');
const gameStatus = document.getElementById('status');
const controls = document.querySelectorAll('[data-input]');
const active = new Map();
let player;

function showError(error) {
  gameStatus.textContent = 'Fields of Silk could not load. Reload to try again.';
  console.error(error);
}

function release(pointerId) {
  const button = active.get(pointerId);
  if (!button) return;
  active.delete(pointerId);
  if ([...active.values()].includes(button)) return;
  button.classList.remove('held');
  player.nes.buttonUp(1, jsnes.Controller['BUTTON_' + button.dataset.input]);
}

for (const button of controls) {
  button.addEventListener('pointerdown', event => {
    if (!player || event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    active.set(event.pointerId, button);
    button.classList.add('held');
    player.nes.buttonDown(1, jsnes.Controller['BUTTON_' + button.dataset.input]);
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(eventName, event => release(event.pointerId));
  }
}
window.addEventListener('blur', () => {
  if (!player) return;
  for (const id of active.keys()) release(id);
  for (let button = 0; button < 8; button++) player.nes.buttonUp(1, button);
});

async function start() {
  try {
    const response = await fetch('/assets/play/fields-of-silk.nes?build=2');
    if (!response.ok) throw new Error('ROM request failed: ' + response.status);
    player = new jsnes.Browser({
      container: gameScreen,
      romData: new Uint8Array(await response.arrayBuffer()),
      onError: showError,
    });
    new ResizeObserver(() => player.fitInParent()).observe(gameScreen);
    gameStatus.textContent = '';
  } catch (error) {
    showError(error);
  }
}

start();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/play-sw.js', { scope: '/play' }).catch(console.warn);
}
