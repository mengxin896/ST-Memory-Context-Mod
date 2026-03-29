/**
 * 结构化记忆工具模块
 *
 * 职责：
 * 1. 解析 AI 返回的结构化 JSON
 * 2. 归一化结构化记忆单元
 * 3. 将记忆单元序列化为稳定的 typed chunk 文本
 * 4. 生成世界书条目所需的数据结构
 *
 * 说明：
 * - 本文件同时兼容浏览器脚本加载与 Node.js 测试环境。
 * - 所有函数都尽量保持纯函数，便于测试与多链路复用。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exported = factory();
        root.Gaigai = root.Gaigai || {};
        root.Gaigai.StructuredMemory = exported;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TYPE_LABELS = {
        character: '人物',
        event: '事件',
        location: '地点',
        item: '物品',
        relationship: '关系',
    };

    const VALID_TYPES = new Set(Object.keys(TYPE_LABELS));

    /**
     * 生成简单稳定哈希
     * @param {string} text 输入文本
     * @returns {string}
     */
    function simpleHash(text) {
        const source = String(text || '');
        let hash = 0;
        for (let i = 0; i < source.length; i++) {
            hash = ((hash << 5) - hash) + source.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * 统一清洗字符串
     * @param {any} value 原始值
     * @returns {string}
     */
    function cleanString(value) {
        return String(value == null ? '' : value)
            .replace(/\r\n/g, '\n')
            .replace(/\u200b/g, '')
            .trim();
    }

    /**
     * 统一清洗数组字符串字段
     * @param {any} value 原始值
     * @returns {string[]}
     */
    function cleanStringArray(value) {
        if (Array.isArray(value)) {
            return Array.from(new Set(value.map(cleanString).filter(Boolean)));
        }
        const single = cleanString(value);
        return single ? [single] : [];
    }

    /**
     * 去掉 Markdown 代码块包装
     * @param {string} text 返回文本
     * @returns {string}
     */
    function stripCodeFence(text) {
        const cleaned = cleanString(text);
        const fenced = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        return fenced ? fenced[1].trim() : cleaned;
    }

    /**
     * 从 AI 文本中提取 JSON 数组
     * @param {string} text AI 返回内容
     * @returns {Array}
     */
    function parseStructuredResponse(text) {
        const raw = stripCodeFence(text);
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');

        if (start === -1 || end === -1 || end < start) {
            throw new Error('结构化抽取结果中未找到 JSON 数组');
        }

        const jsonText = raw.slice(start, end + 1);
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (error) {
            throw new Error(`结构化抽取 JSON 解析失败: ${error.message}`);
        }

        if (!Array.isArray(parsed)) {
            throw new Error('结构化抽取结果不是 JSON 数组');
        }

        return parsed;
    }

    /**
     * 计算总结行签名
     * @param {Object} rowContext 总结行上下文
     * @returns {string}
     */
    function hashSummaryRow(rowContext) {
        const title = cleanString(rowContext?.sourceTitle);
        const note = cleanString(rowContext?.sourceNote);
        const content = cleanString(rowContext?.sourceContent);
        return simpleHash([title, note, content].join('\n---\n'));
    }

    /**
     * 构造结构化单元的稳定哈希
     * @param {Object} meta 归一化后的 meta
     * @returns {string}
     */
    function buildUnitHash(meta) {
        return simpleHash([
            meta.type,
            meta.title,
            meta.summary,
            meta.names.join('|'),
            meta.place,
            meta.time,
            meta.keywords.join('|'),
        ].join('\n'));
    }

    /**
     * 获取结构化单元的主实体
     * @param {string[]} names 实体名数组
     * @returns {string}
     */
    function getPrimaryName(names) {
        return names[0] || '';
    }

    /**
     * 获取关系对象
     * @param {string} type 单元类型
     * @param {string[]} names 实体名数组
     * @returns {string}
     */
    function getRelationshipTarget(type, names) {
        if (type !== 'relationship') {
            return '';
        }
        return names[1] || '';
    }

    /**
     * 将结构化单元序列化为稳定文本
     * @param {Object} unitMeta 归一化后的 meta
     * @returns {string}
     */
    function serializeStructuredUnit(unitMeta) {
        const label = TYPE_LABELS[unitMeta.type] || unitMeta.type;
        const keywords = unitMeta.keywords.length > 0 ? unitMeta.keywords.join(' | ') : '无';
        const sourceNote = unitMeta.sourceNote || '无';
        const relationshipTarget = unitMeta.relationshipTarget || '无';

        return [
            `类型：${label}`,
            `标题：${unitMeta.title || '无标题'}`,
            `主体：${unitMeta.primaryName || '无'}`,
            `关系对象：${relationshipTarget}`,
            `地点：${unitMeta.place || '未知'}`,
            `时间：${unitMeta.time || '未知'}`,
            `关键词：${keywords}`,
            `摘要：${unitMeta.summary || '无'}`,
            `来源标题：${unitMeta.sourceTitle || '无标题'}`,
            `来源备注：${sourceNote}`,
        ].join('\n');
    }

    /**
     * 构造世界书展示内容
     * @param {Object} meta 结构化单元 meta
     * @param {string} vectorText 向量文本
     * @returns {string}
     */
    function buildWorldInfoContent(meta, vectorText) {
        return [
            vectorText,
            `来源索引：${meta.sourceRowIndex}`,
        ].join('\n');
    }

    /**
     * 归一化结构化记忆单元
     * @param {Array} units AI 返回的结构化数组
     * @param {Object} rowContext 总结行上下文
     * @returns {Array<{meta:Object,text:string}>}
     */
    function normalizeStructuredUnits(units, rowContext) {
        if (!Array.isArray(units)) {
            throw new Error('结构化单元必须是数组');
        }

        const sourceRowIndex = Number.isInteger(rowContext?.sourceRowIndex) ? rowContext.sourceRowIndex : 0;
        const sourceTitle = cleanString(rowContext?.sourceTitle) || '无标题';
        const sourceNote = cleanString(rowContext?.sourceNote);
        const sourceContent = cleanString(rowContext?.sourceContent);
        const sourceHash = hashSummaryRow({ sourceTitle, sourceNote, sourceContent });
        const results = [];
        const dedupe = new Set();

        for (const rawUnit of units) {
            const type = cleanString(rawUnit?.type).toLowerCase();
            if (!VALID_TYPES.has(type)) {
                continue;
            }

            const names = cleanStringArray(rawUnit?.names);
            const title = cleanString(rawUnit?.title) || names[0] || sourceTitle;
            const summary = cleanString(rawUnit?.summary);
            if (!summary) {
                continue;
            }

            const meta = {
                type,
                title,
                summary,
                names,
                place: cleanString(rawUnit?.place),
                time: cleanString(rawUnit?.time),
                keywords: cleanStringArray(rawUnit?.keywords),
                sourceRowIndex,
                sourceTitle,
                sourceNote,
                sourceHash,
                primaryName: getPrimaryName(names),
                relationshipTarget: getRelationshipTarget(type, names),
            };

            meta.unitHash = buildUnitHash(meta);
            const dedupeKey = `${meta.type}|${meta.title}|${meta.primaryName}|${meta.relationshipTarget}|${meta.summary}`;
            if (dedupe.has(dedupeKey)) {
                continue;
            }
            dedupe.add(dedupeKey);

            results.push({
                meta,
                text: serializeStructuredUnit(meta),
            });
        }

        return results;
    }

    /**
     * 构造世界书条目关键字
     * @param {Object} meta 结构化单元 meta
     * @returns {{key:string[], keysecondary:string[]}}
     */
    function buildWorldInfoKeys(meta) {
        const primary = [];
        const secondary = [];

        if (meta.primaryName) primary.push(meta.primaryName);
        if (meta.relationshipTarget) primary.push(meta.relationshipTarget);
        if (meta.place) primary.push(meta.place);

        for (const keyword of meta.keywords) {
            if (!primary.includes(keyword)) {
                secondary.push(keyword);
            }
        }

        return {
            key: Array.from(new Set(primary)).filter(Boolean),
            keysecondary: Array.from(new Set(secondary)).filter(Boolean),
        };
    }

    /**
     * 批量构造世界书条目
     * @param {Array<{meta:Object,text:string}>} normalizedUnits 归一化后的单元
     * @param {number} startUid 起始 UID
     * @param {Object} options 配置
     * @returns {Object}
     */
    function buildWorldInfoEntries(normalizedUnits, startUid, options = {}) {
        const vectorized = options.vectorized === true;
        const entries = {};
        let uid = startUid;

        for (const unit of normalizedUnits) {
            const meta = unit.meta;
            const label = TYPE_LABELS[meta.type] || meta.type;
            const { key, keysecondary } = buildWorldInfoKeys(meta);

            entries[String(uid)] = {
                uid,
                key,
                keysecondary,
                comment: `【${label}】${meta.title || meta.primaryName || '未命名条目'}`,
                content: buildWorldInfoContent(meta, unit.text),
                constant: false,
                vectorized,
                enabled: true,
                disable: false,
                position: 1,
                order: 100,
                extensions: {
                    position: 1,
                    exclude_recursion: false,
                    display_index: 0,
                    probability: 100,
                    useProbability: true,
                },
            };
            uid++;
        }

        return entries;
    }

    /**
     * 基于 unitHash 对结构化书籍做增量合并
     * @param {Object|null} existingBook 旧书籍
     * @param {Array<{meta:Object,text:string}>} normalizedUnits 新结构化单元
     * @param {Object} options 配置
     * @returns {Object}
     */
    function reconcileStructuredBook(existingBook, normalizedUnits, options = {}) {
        const oldBook = existingBook || {};
        const previousMetas = Array.isArray(oldBook.metas) ? oldBook.metas : [];
        const previousVectors = Array.isArray(oldBook.vectors) ? oldBook.vectors : [];
        const previousVectorized = Array.isArray(oldBook.vectorized) ? oldBook.vectorized : [];
        const previousChunks = Array.isArray(oldBook.chunks) ? oldBook.chunks : [];
        const reuseMap = new Map();

        for (let index = 0; index < previousMetas.length; index++) {
            const meta = previousMetas[index];
            if (!meta || !meta.unitHash) {
                continue;
            }
            if (!previousVectorized[index] || !previousVectors[index]) {
                continue;
            }
            reuseMap.set(meta.unitHash, {
                vector: previousVectors[index],
                text: previousChunks[index],
                meta,
            });
        }

        const chunks = [];
        const vectors = [];
        const vectorized = [];
        const metas = [];
        let reusedCount = 0;

        for (const unit of normalizedUnits) {
            const cached = reuseMap.get(unit.meta.unitHash);
            chunks.push(unit.text);
            metas.push(unit.meta);

            if (cached) {
                vectors.push(cached.vector);
                vectorized.push(true);
                reusedCount++;
            } else {
                vectors.push(null);
                vectorized.push(false);
            }
        }

        return {
            name: cleanString(oldBook.name) || cleanString(options.fallbackName) || '未命名知识库',
            createTime: oldBook.createTime || options.createTime || Date.now(),
            chunks,
            vectors,
            vectorized,
            metas,
            reusedCount,
        };
    }

    return {
        TYPE_LABELS,
        VALID_TYPES,
        parseStructuredResponse,
        normalizeStructuredUnits,
        serializeStructuredUnit,
        buildWorldInfoContent,
        buildWorldInfoEntries,
        reconcileStructuredBook,
        hashSummaryRow,
        simpleHash,
    };
});
