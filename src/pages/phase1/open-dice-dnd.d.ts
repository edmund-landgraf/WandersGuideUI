declare module 'open-dice-dnd' {
  import type { Camera, Object3D } from 'three';

  export class DiceRoller {
    constructor(options: {
      container: HTMLElement;
      width?: number;
      height?: number;
      throwSpeed?: number;
      throwSpin?: number;
      sounds?: string[];
      soundVolume?: number;
    });
    camera: Camera;
    dice: Array<{ mesh: Object3D }>;
    roll(config: Array<{
      dice: string;
      rolled?: number;
      diceColor?: number;
      textColor?: string;
      backgroundColor?: string;
    }>): Promise<number>;
    destroy(): void;
  }
}
