import { EventEmitter } from 'node:events';

export const feedBus = new EventEmitter();
feedBus.setMaxListeners(0);

export function emitNew(item) {
  feedBus.emit('new', item);
}

export function emitHide(id) {
  feedBus.emit('hide', { id });
}
