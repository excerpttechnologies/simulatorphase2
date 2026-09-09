"use client"
import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

type Props = { active?: boolean; animating?: boolean }

export default function Foup3D({ active, animating }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 1000)
    camera.position.set(1.6, 1.4, 2.8)
    camera.lookAt(0, 0, 0)

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(3, 10, 4)
    scene.add(dir)

    let model: THREE.Object3D | null = null

    // Dynamically import GLTFLoader at runtime so bundlers don't include three/examples on the server
    ;(async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const loader = new GLTFLoader()
        loader.load(
          '/wafer_rack_module.glb',
          (gltf: any) => {
            model = gltf.scene
            model.name = 'waferack'
            model.traverse((c: any) => {
              if (c.isMesh) {
                c.castShadow = true
                c.receiveShadow = true
              }
            })
            // Diagnostic: compute bbox and log size so we can verify scale/placement
            const bbox = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            bbox.getSize(size);
            console.log('[Foup3D] waferack GLB loaded, size=', size.toArray())
            // Ensure visible and sane scale: if height is tiny, upscale; if huge, downscale
            const targetH = 5.5
            let s = 1
            if (size.y > 0) s = targetH / size.y
            model.scale.setScalar(s)
            model.rotation.y = Math.PI
            model.position.y += (1.7 - (bbox.getCenter(new THREE.Vector3()).y * s))
            model.visible = true
            scene.add(model)
          },
          undefined,
          (err) => console.error('[Foup3D] GLTF load error', err)
        )
      } catch (e) {
        console.error('[Foup3D] failed to dynamically import GLTFLoader', e)
      }
    })()


    const resize = () => {
      const w = canvas.clientWidth || 128
      const h = canvas.clientHeight || 128
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }

    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      if (model && animating) model.rotation.y += 0.01
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      if (model) scene.remove(model)
      renderer.dispose()
    }
  }, [animating])

  return <canvas ref={ref} style={{ width: '112px', height: '112px', display: 'block' }} />
}
