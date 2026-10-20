import * as THREE from 'three';
import type { Vec3 } from '../core/geometry/vec';

/**
 * Ядро работает в школьной системе координат (z — вверх), Three.js — в системе с осью y вверх.
 * (x, y, z)_ядро → (x, z, −y)_three. Преобразование ортогональное и сохраняет ориентацию.
 */
export const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v[0], v[2], -v[1]);
export const fromThree = (v: THREE.Vector3): Vec3 => [v.x, -v.z, v.y];
