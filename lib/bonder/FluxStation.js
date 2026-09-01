'use client'

import * as THREE from 'three'

/**
 * Visual central flux station. All child points are model-local and remain
 * stable when the complete bonder model is fitted/scaled for display.
 */
export class FluxStation {
  constructor(config) {
    this.config = config
    this.group = new THREE.Group()
    this.group.name = 'CENTRAL_FLUX_STATION'
    this.points = {}
    this._build()
  }

  _mesh(name, geometry, material, parent = this.group) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  _point(name, position, parent = this.group) {
    const point = new THREE.Object3D()
    point.name = name
    point.position.copy(position)
    parent.add(point)
    this.points[name] = point
    return point
  }

  _build() {
    const width = 0.42
    const depth = 0.30
    const bottomHeight = 0.06
    const wallHeight = 0.2
    const wallThickness = 0.045
    const floorY = 0
    const fluxY = floorY + bottomHeight + 0.09
    const wallY = floorY + bottomHeight + wallHeight / 2

    const metal = new THREE.MeshStandardMaterial({
      color: 0x56616b,
      metalness: 0.72,
      roughness: 0.3,
    })
    const innerMetal = new THREE.MeshStandardMaterial({
      color: 0x26323a,
      metalness: 0.58,
      roughness: 0.38,
    })
    const fluxMaterial = new THREE.MeshStandardMaterial({
      color: 0x9a7a32,
      emissive: 0x3b2607,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.82,
      roughness: 0.24,
      metalness: 0.08,
      side: THREE.DoubleSide,
    })

    this._mesh('FLUX_STATION_BOTTOM', new THREE.BoxGeometry(width, bottomHeight, depth), metal).position.y = floorY + bottomHeight / 2
    this._mesh('FLUX_STATION_INNER_FLOOR', new THREE.BoxGeometry(width - wallThickness * 2, 0.025, depth - wallThickness * 2), innerMetal).position.y = floorY + bottomHeight + 0.015

    const left = this._mesh('FLUX_STATION_LEFT_WALL', new THREE.BoxGeometry(wallThickness, wallHeight, depth), metal)
    left.position.set(-width / 2 + wallThickness / 2, wallY, 0)
    const right = this._mesh('FLUX_STATION_RIGHT_WALL', new THREE.BoxGeometry(wallThickness, wallHeight, depth), metal)
    right.position.set(width / 2 - wallThickness / 2, wallY, 0)
    const front = this._mesh('FLUX_STATION_FRONT_WALL', new THREE.BoxGeometry(width, wallHeight, wallThickness), metal)
    front.position.set(0, wallY, depth / 2 - wallThickness / 2)
    const back = this._mesh('FLUX_STATION_BACK_WALL', new THREE.BoxGeometry(width, wallHeight, wallThickness), metal)
    back.position.set(0, wallY, -depth / 2 + wallThickness / 2)

    const flux = this._mesh('FLUX_MATERIAL', new THREE.BoxGeometry(width - wallThickness * 2 - 0.02, 0.03, depth - wallThickness * 2 - 0.02), fluxMaterial)
    flux.position.y = fluxY

    this._point('FLUX_APPROACH_POINT', new THREE.Vector3(0, fluxY + 0.34, 0))
    this._point('FLUX_DIP_POINT', new THREE.Vector3(0, fluxY - this.config.dipDepth * 0.65, 0))
    this._point('FLUX_RETRACT_POINT', new THREE.Vector3(0, fluxY + 0.34, 0))

    const receiving = new THREE.Group()
    receiving.name = 'RECEIVING_PLATE'
    receiving.position.set(width + 0.24, 0, 0)
    this.group.add(receiving)
    const plate = this._mesh('RECEIVING_PLATE_TOP', new THREE.BoxGeometry(0.72, 0.08, 0.58), metal, receiving)
    plate.position.y = 0.04
    const plateInset = this._mesh('RECEIVING_PLATE_INSET', new THREE.BoxGeometry(0.58, 0.012, 0.44), innerMetal, receiving)
    plateInset.position.y = 0.087
    this._point('RECEIVING_PLATE_POINT', new THREE.Vector3(0, 0.12, 0), receiving)

    this.group.userData.fluxSurfaceY = fluxY
    this.group.userData.receivingPlate = receiving
  }

  getPoint(name) {
    return this.points[name] || null
  }
}
