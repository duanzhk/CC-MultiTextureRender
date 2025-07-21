import { dynamicAtlasManager, IAssembler, Sprite, UI,RenderData } from "cc"
import { UIMultiSprite } from "./UIMultiSprite";

//#region simple
let simple: IAssembler;
const _simple = {
    updateTexIdx(sprite:UIMultiSprite){
        const renderData = sprite.renderData!;
        let offset = 9
        for (let i = 0; i < 4; i++, offset += renderData.floatStride) {
            renderData.chunk.vb[offset] = sprite.texIdx;
        }
    },
    
    updateRenderData (sprite: Sprite) {
        const frame = sprite.spriteFrame;

        dynamicAtlasManager.packToDynamicAtlas(sprite, frame);
        this.updateUVs(sprite);// dirty need
        //this.updateColor(sprite);// dirty need

        const renderData = sprite.renderData;
        if (renderData && frame) {
            if (renderData.vertDirty) {
                this.updateVertexData(sprite);
            }
            this.updateTexIdx(sprite);
            renderData.updateRenderData(sprite, frame);
        }
    },

    //@ts-ignore
    fillBuffers (sprite: Sprite, renderer: IBatcher) {
        if (sprite === null) {
            return;
        }

        const renderData = sprite.renderData!;
        const chunk = renderData.chunk;
        //@ts-ignore
        if (sprite._flagChangedVersion !== sprite.node.flagChangedVersion || renderData.vertDirty) {
            // const vb = chunk.vertexAccessor.getVertexBuffer(chunk.bufferId);
            this.updateWorldVerts(sprite, chunk);
            this.updateTexIdx(sprite);
            renderData.vertDirty = false;
            //@ts-ignore
            sprite._flagChangedVersion = sprite.node.flagChangedVersion;
        }

        // quick version
        const vidOrigin = chunk.vertexOffset;
        const meshBuffer = chunk.meshBuffer;
        const ib = chunk.meshBuffer.iData;
        let indexOffset = meshBuffer.indexOffset;

        const vid = vidOrigin;

        // left bottom
        ib[indexOffset++] = vid;
        // right bottom
        ib[indexOffset++] = vid + 1;
        // left top
        ib[indexOffset++] = vid + 2;

        // right bottom
        ib[indexOffset++] = vid + 1;
        // right top
        ib[indexOffset++] = vid + 3;
        // left top
        ib[indexOffset++] = vid + 2;

        // IndexOffset should add 6 when vertices of a rect are visited.
        meshBuffer.indexOffset += 6;
        // slow version
        // renderer.switchBufferAccessor().appendIndices(chunk);
    },

    updateUVs(sprite: Sprite) {
        if (!sprite.spriteFrame) return;
        const renderData = sprite.renderData!;
        const vData = renderData.chunk.vb;
        const uv = sprite.spriteFrame.uv;
        // vData[3] = uv[0];
        // vData[4] = uv[1];
        // vData[12] = uv[2];
        // vData[13] = uv[3];
        // vData[21] = uv[4];
        // vData[22] = uv[5];
        // vData[30] = uv[6];
        // vData[31] = uv[7];
        let offset = 3;
        let count = 0;
        for (let i = 0; i < 4; i++, offset += renderData.floatStride) {
            vData[offset] = uv[count++];
            vData[offset + 1] = uv[count++]
        }
    },
};
//#endregion

//#region sliced
let sliced: IAssembler;
const _sliced = {
    updateTexIdx(sprite:UIMultiSprite){
        const renderData = sprite.renderData!;
        let offset = 9; // texIdx在顶点数据中的偏移位置
        // sliced类型使用16个顶点（4x4网格），需要为每个顶点设置texIdx
        for (let i = 0; i < 16; i++, offset += renderData.floatStride) {
            renderData.chunk.vb[offset] = sprite.texIdx;
        }
    },

    updateRenderData (sprite: Sprite) {
        const frame = sprite.spriteFrame;

        // TODO: Material API design and export from editor could affect the material activation process
        // need to update the logic here
        // if (frame) {
        //     if (!frame._original && dynamicAtlasManager) {
        //         dynamicAtlasManager.insertSpriteFrame(frame);
        //     }
        //     if (sprite._material._texture !== frame._texture) {
        //         sprite._activateMaterial();
        //     }
        // }
        dynamicAtlasManager.packToDynamicAtlas(sprite, frame);
        // TODO update material and uv
        this.updateUVs(sprite); // dirty need
        //this.updateColor(sprite); // dirty need

        const renderData = sprite.renderData;
        if (renderData && frame) {
            const vertDirty = renderData.vertDirty;
            if (vertDirty) {
                this.updateVertexData(sprite);
            }
            this.updateTexIdx(sprite);
            renderData.updateRenderData(sprite, frame);
        }
    },

    //@ts-ignore
    fillBuffers (sprite: Sprite, renderer: IBatcher) {
        const renderData: RenderData = sprite.renderData!;
        const chunk = renderData.chunk;
         //@ts-ignore
        if (sprite._flagChangedVersion !== sprite.node.flagChangedVersion || renderData.vertDirty) {
            this.updateWorldVertexData(sprite, chunk);
            this.updateTexIdx(sprite);
            renderData.vertDirty = false;
             //@ts-ignore
            sprite._flagChangedVersion = sprite.node.flagChangedVersion;
        }

        const bid = chunk.bufferId;
        const vid = chunk.vertexOffset;
        const meshBuffer = chunk.meshBuffer;
        const ib = chunk.meshBuffer.iData;
        let indexOffset = meshBuffer.indexOffset;
        for (let r = 0; r < 3; ++r) {
            for (let c = 0; c < 3; ++c) {
                const start = vid + r * 4 + c;
                ib[indexOffset++] = start;
                ib[indexOffset++] = start + 1;
                ib[indexOffset++] = start + 4;
                ib[indexOffset++] = start + 1;
                ib[indexOffset++] = start + 5;
                ib[indexOffset++] = start + 4;
            }
        }
        meshBuffer.indexOffset = indexOffset;
    },
}
//#endregion

function getAssembler(sprite: Sprite) {
    const assembler = Sprite.Assembler.getAssembler(sprite);
    switch (sprite.type) {
        case Sprite.Type.SIMPLE:
            if (!simple) {
                simple = Object.create(assembler);
                Object.assign(simple, _simple);
            }
            return simple;
        case Sprite.Type.SLICED:
            if (!sliced) {
                sliced = Object.create(assembler);
                Object.assign(sliced, _sliced);
            }
            return sliced;
        default:
            return assembler;
    }
}

export { getAssembler };
