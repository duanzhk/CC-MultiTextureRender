import { _decorator, Component, Node, Sprite, Label, UIRenderer, __private, UITransform } from 'cc';
const { ccclass, property, executionOrder } = _decorator;

type IBatcher = __private._cocos_2d_renderer_i_batcher__IBatcher
type fillBuffers = (render: IBatcher) => void

interface ComponentInfo {
    component: UIRenderer;
    originalFillBuffers: fillBuffers;
}

/**
 * 只优化此节点下的子孙UI元素，不影响场景中其他UI。
 */
@ccclass('BatchController')
@executionOrder(110) // 在UIRenderer的默认executionOrder之后
export class BatchController extends Component {

    @property({ displayName: "静态资源", tooltip: "如果元素是运行时动态创建的，需要关闭此选项" })
    static: boolean = false;

    @property({ displayName: "调试模式" })
    debugMode: boolean = false;

    // 按纹理分组存储组件信息
    private _componentGroups = new Map<string, ComponentInfo[]>();
    // 本帧待处理的渲染组件
    private _pendingRenders = new Map<string, UIRenderer[]>();

    private _isReordering: boolean = false; // 是否处于重排渲染阶段
    private _isProcessScheduled: boolean = false; // 防止重复调度
    private _batcher: IBatcher = null;

    onLoad() {
        if (this.static) {
            this.initBatch();
        }
    }

    onDisable() {
        this.restoreOriginalMethods();
    }

    /**
     * 初始化 - 收集、分组并Hook
     */
    private initBatch(): void {
        this.collectAndGroupComponents();

        if (this.debugMode) {
            console.log('[BatchController] 组件分组信息:');
            this._componentGroups.forEach((group, textureKey) => console.log(`  批次: ${textureKey} (${group.length} 个组件)`));
        }
    }

    private getTextureKey(comp: UIRenderer): string {
        if (comp instanceof Sprite && comp.spriteFrame && comp.spriteFrame.texture)
            return `Sprite-${comp.spriteFrame.texture.getHash()}`;
        if (comp instanceof Label && (comp.font || comp.fontFamily))
            return `Label-${comp.font?.uuid || comp.fontFamily}`;
        return 'Unknown';
    }

    /**
     * 收集并按纹理分组存储组件及其原始方法
     */
    private collectAndGroupComponents(): void {
        this._componentGroups.clear();

        const allComponents = this.node.getComponentsInChildren(UIRenderer).filter(c => c instanceof Sprite || c instanceof Label);
        allComponents.forEach(comp => {
            const textureKey = this.getTextureKey(comp);
            if (!this._componentGroups.has(textureKey)) {
                this._componentGroups.set(textureKey, []);
            }
            const group = this._componentGroups.get(textureKey)!;

            // 避免重复处理
            if (group.some(info => info.component === comp)) return;

            const compInfo: ComponentInfo = {
                component: comp,
                originalFillBuffers: comp.fillBuffers.bind(comp)
            };
            group.push(compInfo);

            // 拦截fillBuffers方法
            comp.fillBuffers = (batcher: IBatcher) => {
                this.interceptFillBuffers(comp, batcher);
            };
        });

        // 按照先渲染Sprite再渲染Label的顺序排序
        const getPriority = (key: string) => key.startsWith('Sprite-') ? 0 : 1;
        const sortedEntries = Array.from(this._componentGroups.entries()).sort((a, b) => {
            return getPriority(a[0]) - getPriority(b[0]);
        });
        // 清空原Map并按排序结果重新插入
        this._componentGroups.clear();
        sortedEntries.forEach(([key, value]) => {
            this._componentGroups.set(key, value);
        });
    }

    /**
     * 拦截fillBuffers调用
     */
    private interceptFillBuffers(comp: UIRenderer, batcher: IBatcher): void {
        // 如果正在重排，说明是我们的代码在调用，直接执行原始渲染
        if (this._isReordering) {
            for (const group of this._componentGroups.values()) {
                const info = group.find(i => i.component === comp);
                if (info) {
                    info.originalFillBuffers(batcher);
                    break;
                }
            }
            return;
        }

        // 收集阶段：只记录需要渲染的组件，不执行渲染
        this._batcher = batcher; // 保存对batcher的引用

        //  interceptFillBuffers 是否还需要 _pendingRenders？
        //  _componentGroups：这是一个静态的“花名册”。它在初始化时被创建，包含了此节点下所有可能被渲染的组件，并按照纹理分组。它在运行时不会改变（除非你调用refresh）。
        //   _pendingRenders：这是一个动态的“点名册”。它在每一帧被填充，只记录那些在当前帧确实需要被渲染的组件。
        //  想象一下 ScrollView 的工作场景：
        //  Item1 和 Item2 在屏幕内，它们的 fillBuffers 会被调用。
        //  Item3、Item4...Item100 在屏幕外，它们被ScrollView剔除了，它们的fillBuffers根本不会被调用。
        //  如果我们 processReordering 直接遍历 _componentGroups 并渲染所有组件，就会把屏幕外的 Item3 到 Item100 也全都画出来。
        //  因此，_pendingRenders 的作用是：在每一帧，精确地告诉我们，在那本“花名册”(_componentGroups)上，哪些人“今天来上课了”（需要被渲染）。
        const textureKey = this.getTextureKey(comp);
        if (!this._pendingRenders.has(textureKey)) {
            this._pendingRenders.set(textureKey, []);
        }
        this._pendingRenders.get(textureKey)!.push(comp);

        // 关键：使用微任务调度，确保只在walk结束后执行一次
        // 使用微任务（Microtask）
        // 为了解决这个问题，我们需要一个机制，它能在walk流程结束之后，但在渲染管线提交之前这个精确的时间点执行我们的重排逻辑。最佳选择就是利用JavaScript的微任务 (Promise.resolve().then())。
        // 微任务：会在当前同步代码块执行完毕后，立即执行。
        // 应用场景：当第一个被我们Hook的fillBuffers调用时，我们安排一个微任务。这个微任务会等待整个walk流程（这是一个同步代码块）全部执行完毕，然后立即抢在引擎进入下一步渲染流程前执行，完美地解决了时序问题。
        if (!this._isProcessScheduled) {
            this._isProcessScheduled = true;
            Promise.resolve().then(() => {
                this.processReordering();
                this._isProcessScheduled = false;
            });
        }
    }

    /**
     * 执行重排渲染
     */
    private processReordering(): void {
        if (this._pendingRenders.size === 0) return;

        this._isReordering = true;

        if (this.debugMode) console.log(`[BatchController] LateUpdate: 开始重排 ${this._pendingRenders.size} 个批次`);

        // 关键：先完成当前batcher中，我们范围之外的UI元素的批次
        this._batcher.autoMergeBatches();

        this._componentGroups.forEach((compInfo, groupId) => {
            const comps = this._pendingRenders.get(groupId);
            if (!comps || comps.length === 0) return;

            if (this.debugMode) console.log(`  -> 处理批次: ${groupId} (${comps.length}个组件)`);

            // 只渲染本帧“点了名”的组件
            compInfo.forEach(info => {
                if (comps.indexOf(info.component) !== -1) {
                    info.originalFillBuffers(this._batcher);
                }
            });

            this._batcher.autoMergeBatches();
        });

        // 清理，为下一帧做准备
        this._pendingRenders.clear();
        this._isReordering = false;
    }

    /**
     * 恢复所有被修改的原始方法
     */
    private restoreOriginalMethods(): void {
        this._componentGroups.forEach(compInfo => {
            compInfo.forEach(info => {
                if (info.component && info.component.isValid) {
                    info.component.fillBuffers = info.originalFillBuffers;
                }
            });
        });
    }

    public batch(): void {
        if (this.static) {
            console.warn('[BatchController] 动态批处理只能在非静态资源模式下使用');
            return;
        }
        this.restoreOriginalMethods();
        this.initBatch();
    }

}