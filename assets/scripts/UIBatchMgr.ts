// cocos支持自动合批，合批规则[https://docs.cocos.com/creator/3.8/manual/zh/ui-system/components/engine/ui-batch.html]
// 所以我们要做的是把不符合规则的部分改成符合规则，那么自然就会被cocos自动合批了。

import { _decorator, Node, Material, Component, Texture2D, CCBoolean } from 'cc';
import { UIMultiSprite } from './UIMultiSprite';
import { DEBUG } from 'cc/env';
const { ccclass, property } = _decorator;

@ccclass("UIMultipleTexturesBatch")
export class UIBatchMgr extends Component {
    @property(Material)
    material: Material = null!;
    @property(CCBoolean)
    static: boolean = false

    //每个material最多可以绑定多少张图片
    private readonly _maxTexsPerMat = 8;

    start() {
        // 子物体都是非动态创建的情况
        if (this.static) {
            this.batch();
        }
    }

    public batch() {
        const sprites: UIMultiSprite[] = [];
        this._collectSpritesRecursive(this.node, sprites);
        this._processSprites(sprites);
    }

    private _collectSpritesRecursive(node: Node, sprites: UIMultiSprite[]) {
        for (const child of node.children) {
            if (child.getComponent(UIBatchMgr)) {
                throw new Error("UIBatchMgr不能嵌套使用");
            }

            const sprite = child.getComponent(UIMultiSprite);
            if (sprite) {
                sprites.push(sprite);
            }
            this._collectSpritesRecursive(child, sprites);
        }
    }

    private _processSprites(sprites: UIMultiSprite[]) {
        //
        const gid2tex2idx: Map<number, Map<Texture2D, number>> = new Map();
        //groupid对应的材质球
        const gid2mat: Map<number, Material> = new Map()
        //groupid对应的图片hash值
        const gid2hash: Map<number, number> = new Map()

        let gid = 0// 当前分组ID
        const curGroupTexs = new Set<Texture2D>(); // 当前分组纹理集合
        let prevTexture: Texture2D | null = null; // 上一个sprite的纹理

        for (const sprite of sprites) {
            const texture = sprite.spriteFrame?.texture as Texture2D;
            if (!texture) continue;

            //如果相邻的sprite使用相同的texture，则这个俩个sprite归属同一个groupid。
            //如果相邻的sprite使用不同的texture，有如下情况：
            //1、当前分组不满_maxTexsPerMat，把这个sprite归属当前分组。
            //2、当前分组正好满_maxTexsPerMat，则新开一个分组，这个sprite归属新分组。
            if (prevTexture != texture && !curGroupTexs.has(texture)) {
                if (curGroupTexs.size >= this._maxTexsPerMat) {
                    gid++;
                    curGroupTexs.clear();
                }
                curGroupTexs.add(texture);
            }
            // 更新状态
            prevTexture = texture;

            //把同一组内的texture的hash值设置为相同，这样就可以被cocos自动合批了
            let hash = gid2hash.get(gid);
            if (!gid2hash.has(gid)) {
                hash = gid
                gid2hash.set(gid, hash)
            } else {
                hash = gid2hash.get(gid)!
            }
            //@ts-ignore
            texture._textureHash = hash;

            //同一组内的sprite使用相同的材质球
            let mat = gid2mat.get(gid)
            if (!mat) {
                mat = new Material()
                mat.copy(this.material)
                gid2mat.set(gid, mat)
            }

            //给每组的材质球绑定图片，最多_maxTexsPerMat张，设置这组内sprite的texIdx
            const tex2idx = gid2tex2idx.get(gid) || new Map<Texture2D, number>()
            gid2tex2idx.set(gid, tex2idx)
            let texidx:number
            if (!tex2idx.has(texture)) {
                texidx = tex2idx.size + 1
                tex2idx.set(texture, texidx)
                mat.setProperty("texture" + texidx, texture)
            } else {
                texidx = tex2idx.get(texture)!
            }
            sprite.texIdx = texidx
            sprite.customMaterial = mat

            if(DEBUG) {
                console.log("groupId:", gid, "textureIndex:", texidx, "materialHash:", mat.hash)
            }
        }
    }
}
