import { gfx, _decorator, Sprite, __private, RenderData, SpriteFrame } from 'cc';
import { getAssembler } from './multiAssembler';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

// 自定义顶点格式
const vfmt = [
    new gfx.Attribute(gfx.AttributeName.ATTR_POSITION, gfx.Format.RGB32F),
    new gfx.Attribute(gfx.AttributeName.ATTR_TEX_COORD, gfx.Format.RG32F),
    new gfx.Attribute(gfx.AttributeName.ATTR_COLOR, gfx.Format.RGBA32F),
    new gfx.Attribute("a_texIdx", gfx.Format.R32F),
]

@ccclass('UIMultiSprite')
export class UIMultiSprite extends Sprite {
    private _texIdx: number = 0;
    set texIdx(idx: number) {
        this._texIdx = idx;
        this._updateTexIds();
    }
    get texIdx() {
        return this._texIdx;
    }

    private _updateTexIds() {
        if (this._assembler) {
            this._assembler.updateTexIdx(this);
            this.markForUpdateRenderData()
        }
    }

    requestRenderData(drawInfoType?: __private._cocos_2d_renderer_render_draw_info__RenderDrawInfoType): RenderData {
        const myRenderData = RenderData.add(vfmt);
        myRenderData.initRenderDrawInfo(this, drawInfoType);
        this._renderData = myRenderData
        return myRenderData
    }

    protected _flushAssembler(): void {
        // modify
        const assembler = getAssembler(this);

        if (this._assembler !== assembler) {
            this.destroyRenderData();
            this._assembler = assembler;
        }

        if (!this._renderData) {
            if (this._assembler && this._assembler.createData) {
                this._renderData = this._assembler.createData(this);
                this._renderData!.material = this.getRenderMaterial(0);
                this.markForUpdateRenderData();
                if (this.spriteFrame) {
                    this._assembler.updateUVs(this);
                }
                this._updateColor();
                this._updateTexIds();
            }
        }

        // Only Sliced type need update uv when sprite frame insets changed
        if (this._spriteFrame) {
            if (this._type === /*SpriteType.SLICED*/ 1) {
                this._spriteFrame.on(SpriteFrame.EVENT_UV_UPDATED, (this as any)._updateUVs, this);
            } else {
                this._spriteFrame.off(SpriteFrame.EVENT_UV_UPDATED, (this as any)._updateUVs, this);
            }
        }
    }

}