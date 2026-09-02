import * as THREE from "three/webgpu";

const UP = new THREE.Vector3(0, 1, 0);

// Full port of revo-realms' PlayerCamera.ts follow-cam, yaw-tracking restored —
// the camera orbits to stay behind the player as he turns, not just translates.
export const playerCameraConfig = {
  OFFSET: new THREE.Vector3(-17, 35, 25),
  TARGET_HEIGHT_IN_METERS: 5,
  POSITION_FOLLOW_SPEED_IN_INVERSE_SECONDS: 12,
  TARGET_FOLLOW_SPEED_IN_INVERSE_SECONDS: 18,
  ROTATION_FOLLOW_SPEED_IN_INVERSE_SECONDS: 10,
};

export class PlayerCamera {
  private camera: THREE.PerspectiveCamera;
  private smoothedPosition = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();
  private smoothedTarget = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private yawInRadians = 0;
  private yawQuaternion = new THREE.Quaternion();

  constructor(camera: THREE.PerspectiveCamera, focusPosition: THREE.Vector3, initialYawInRadians: number) {
    this.camera = camera;
    this.snapYaw(initialYawInRadians);

    this.desiredPosition.copy(playerCameraConfig.OFFSET).applyQuaternion(this.yawQuaternion).add(focusPosition);
    this.smoothedPosition.copy(this.desiredPosition);
    this.desiredTarget.copy(focusPosition).setY(playerCameraConfig.TARGET_HEIGHT_IN_METERS);
    this.smoothedTarget.copy(this.desiredTarget);
    camera.position.copy(this.smoothedPosition);
    camera.lookAt(this.smoothedTarget);
  }

  update(delta: number, focusPosition: THREE.Vector3, playerYawInRadians: number) {
    const {
      POSITION_FOLLOW_SPEED_IN_INVERSE_SECONDS: positionFollow,
      TARGET_FOLLOW_SPEED_IN_INVERSE_SECONDS: targetFollow,
    } = playerCameraConfig;

    this.updateYaw(delta, playerYawInRadians);

    this.desiredPosition.copy(playerCameraConfig.OFFSET).applyQuaternion(this.yawQuaternion).add(focusPosition);
    this.smoothedPosition.lerp(this.desiredPosition, 1 - Math.exp(-positionFollow * delta));

    this.desiredTarget.copy(focusPosition);
    this.desiredTarget.y += playerCameraConfig.TARGET_HEIGHT_IN_METERS;
    this.smoothedTarget.lerp(this.desiredTarget, 1 - Math.exp(-targetFollow * delta));

    this.camera.position.copy(this.smoothedPosition);
    this.camera.lookAt(this.smoothedTarget);
  }

  snapYaw(playerYawInRadians: number) {
    this.yawInRadians = playerYawInRadians;
    this.yawQuaternion.setFromAxisAngle(UP, this.yawInRadians);
  }

  private updateYaw(delta: number, playerYawInRadians: number) {
    const { ROTATION_FOLLOW_SPEED_IN_INVERSE_SECONDS: rotationFollow } = playerCameraConfig;

    const yawOffset = playerYawInRadians - this.yawInRadians;
    const yawDelta = Math.atan2(Math.sin(yawOffset), Math.cos(yawOffset));

    this.yawInRadians += yawDelta * (1 - Math.exp(-rotationFollow * delta));
    this.yawQuaternion.setFromAxisAngle(UP, this.yawInRadians);
  }
}
