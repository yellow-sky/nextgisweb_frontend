import {KeyCodes} from './KeysCodes';

/**
 * @param {string} key - key symbol
 * @param {string} func - action on key press
 * @param {number} [keyCode] - key code for special button like tab
 *
 * @export
 * @interface IKeyControl
 */
export interface IKeyControl {
  key?: string;
  keyCode?: number;
  func: () => void;
}

export class Keys {

  keyCodeAlias = new KeyCodes();

  keys: {[keyCode: number]: boolean} = {};

  private _windowOnFocus?: () => void;
  private _keysPressed?: () => void;
  private _keysReleased?: () => void;

  constructor() {
    this._windowOnFocus = this.windowOnFocus.bind(this);
    this._keysPressed = this.keysPressed.bind(this);
    this._keysReleased = this.keysReleased.bind(this);
    this.addKeyboardEventsListener();
  }

  pressed(keyName: keyof KeyCodes): boolean {
    const code = this.keyCodeAlias[keyName];
    if (code) {
      return this.keys[code];
    }
  }

  addKeyboardEventsListener() {
    window.addEventListener('focus', this._windowOnFocus, false);
    window.addEventListener('keydown', this._keysPressed, false);
    window.addEventListener('keyup', this._keysReleased, false);
  }

  removeKeyboardEventsListener() {
    window.removeEventListener('focus', this._windowOnFocus, false);
    window.removeEventListener('keydown', this._keysPressed, false);
    window.removeEventListener('keyup', this._keysReleased, false);
  }

  private keysPressed(e) {
    e.stopPropagation();
    if (!this.keys[e.keyCode]) {
      this.keys[e.keyCode] = true;
    }
  }

  private keysReleased(e) {
    e.stopPropagation();
    this.keys[e.keyCode] = false;
  }

  private windowOnFocus() {
    this.keys = {};
  }
}
