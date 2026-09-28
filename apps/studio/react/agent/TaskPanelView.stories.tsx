import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { TaskPanelView } from './TaskPanelView';

function controllerFor(state:any) {
  return {
    subscribe: () => () => {},
    snapshot: () => state,
    runQuickTask: fn(async () => {}),
    markActivityRead: fn(),
    openSettings: fn(),
  };
}

const readyController = controllerFor({
  busy:false,
  available:true,
  activeTaskKey:null,
  activityCount:2,
  status:{ state:'ready', label:'Agent ready', detail:'Runtime 与工具链已就绪。' },
  journey:null,
  logs:[
    { id:'1', kind:'result', text:'Runtime ready' },
    { id:'2', kind:'plan', text:'等待任务' },
  ],
});

const meta = {
  title: 'Studio/Agent/TaskPanel',
  component: TaskPanelView,
  args: { controller:readyController },
} satisfies Meta<typeof TaskPanelView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvas, args }) => {
    const task = canvas.getAllByRole('button', { name:/拿起杯子/ })[0];
    await userEvent.click(task);
    await expect(args.controller.runQuickTask).toHaveBeenCalledTimes(1);

    await userEvent.click(canvas.getByText('Raw activity'));
    await expect(args.controller.markActivityRead).toHaveBeenCalledTimes(1);
  },
};

export const RunningJourney: Story = {
  args:{
    controller:controllerFor({
      busy:true,
      available:true,
      activeTaskKey:null,
      activityCount:1,
      status:{ state:'running', label:'执行中', detail:'正在完成具身任务。' },
      journey:{
        state:'running',
        intent:'把杯子放到桌上',
        actions:[{ label:'导航到杯子', state:'success', outcome:'success' },{ label:'拿起杯子', state:'running' }],
        changes:[{ label:'agent_01 moved', state:'success', detail:'已到达 cup_01' }],
        result:{ state:'running', label:'执行中', detail:'等待最终验证。' },
      },
      logs:[{ id:'1', kind:'plan', text:'Executing task' }],
    }),
  },
};
