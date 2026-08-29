export const PHYSICS_BACKENDS = Object.freeze([
  Object.freeze({ id: "rapier", title: "Rapier" }),
  Object.freeze({ id: "jolt", title: "Jolt" }),
  Object.freeze({ id: "compare", title: "Rapier ↔ Jolt" })
]);

export function isPhysicsBackend(id) {
  return PHYSICS_BACKENDS.some((backend) => backend.id === id);
}

export async function createPhysicsBackend(id = "rapier") {
  if (id === "rapier") {
    const { RapierPhysicsBackend } = await import("../../../world/runtime/physics/RapierPhysicsBackend.js");
    return new RapierPhysicsBackend();
  }
  if (id === "jolt") {
    const { JoltPhysicsBackend } = await import("../../../world/runtime/physics/JoltPhysicsBackend.js");
    return new JoltPhysicsBackend();
  }
  throw new Error(`Unsupported executable physics backend: ${id}`);
}
