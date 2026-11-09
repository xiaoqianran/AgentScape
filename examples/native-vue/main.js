import { createApp, defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { createNativeWorldHost } from '../native-frameworks/createNativeWorldHost.js';

const NativeWorld = defineComponent({
  name: 'NativeWorld',
  setup() {
    const container = ref(null);
    const status = ref('connecting');
    let host = null;
    onMounted(() => {
      host = createNativeWorldHost(container.value, value => { status.value = value; });
      window.nativeFrameworkDemo = host;
      void host.start();
    });
    onBeforeUnmount(() => {
      host?.dispose();
      if (window.nativeFrameworkDemo === host) delete window.nativeFrameworkDemo;
    });
    return () => h('section', { style: { padding: '24px', maxWidth: '960px' } }, [
      h('h1', 'Vue + 原生 Three.js + AgentScape'),
      h('p', { 'data-testid': 'status' }, status.value),
      h('button', { type: 'button', onClick: () => host?.detach() }, '仅卸载 AgentScape'),
      h('div', {
        ref: container, 'data-testid': 'canvas-host',
        style: { marginTop: '12px', minHeight: '420px', width: '100%' }
      })
    ]);
  }
});

const app = createApp(NativeWorld);
app.mount('#app');
window.unmountNativeFramework = () => app.unmount();
