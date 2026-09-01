'use client'

/**
 * FluxStationController — models the flux station and the dipping operation.
 * The chip must physically descend into the flux container (driven by the
 * orchestrator moving the tool that holds the chip). This controller only
 * tracks/validates state so the recipe never marks fluxed until it truly dips.
 */
export class FluxStationController {
  constructor(config) {
    this.config = config.flux
    this.state = { ready: false, dipping: false, dipped: false }
  }

  begin() {
    this.state.ready = true
    this.state.dipping = true
    this.state.dipped = false
  }

  /**
   * @param dipDepthReached whether the tool/chip reached the required depth.
   */
  completeDip(dipDepthReached) {
    this.state.dipped = !!(dipDepthReached && this.state.dipping)
    this.state.dipping = false
    return this.state.dipped
  }

  reset() {
    this.state = { ready: false, dipping: false, dipped: false }
  }
}
