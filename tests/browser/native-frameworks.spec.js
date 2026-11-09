import { test, expect } from '@playwright/test';

for (const framework of ['react', 'vue']) {
  test(`${framework} native Three.js stays alive across AgentScape attach, detach and component unmount`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/examples/native-${framework}/`);
    await expect(page.getByTestId('status')).toHaveText('ready', { timeout: 90_000 });
    const before = await page.evaluate(() => {
      const host = window.nativeFrameworkDemo;
      const session = host.session;
      const cup = session.world.store.get('framework_cup').object;
      return {
        sameScene: cup.parent === session.world.scene && session.world.scene.parent === host.scene,
        hostObject: host.scene.getObjectByName('FrameworkLandmark') === host.landmark,
        registered: session.scene.observe().nativeObjects.some(item => item.id === 'host:landmark'),
        interactive: session.scene.observe().nativeInteractions.items.some(item => item.id === 'host:landmark'),
        originalMaterial: host.landmark.material.uuid,
        canvasAttached: host.renderer.domElement.isConnected,
        nativeCapabilities: session.scene.capabilities.nativeObjectRegistration
      };
    });
    expect(before).toMatchObject({
      sameScene: true, hostObject: true, registered: true, interactive: true,
      canvasAttached: true, nativeCapabilities: true
    });

    await page.getByRole('button', { name: '仅卸载 AgentScape' }).click();
    await expect(page.getByTestId('status')).toHaveText('detached');
    const after = await page.evaluate(() => {
      const host = window.nativeFrameworkDemo;
      return {
        canvasAttached: host.renderer.domElement.isConnected,
        hostObject: host.scene.getObjectByName('FrameworkLandmark') === host.landmark,
        originalMaterial: host.landmark.material.uuid,
        runtimeRemoved: !host.scene.getObjectByName('AgentScapeRoot')
      };
    });
    expect(after).toEqual({
      canvasAttached: true, hostObject: true,
      originalMaterial: before.originalMaterial, runtimeRemoved: true
    });

    await page.evaluate(() => window.unmountNativeFramework());
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
