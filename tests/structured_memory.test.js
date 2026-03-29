const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseStructuredResponse,
    normalizeStructuredUnits,
    serializeStructuredUnit,
    buildWorldInfoEntries,
    reconcileStructuredBook,
    hashSummaryRow,
} = require('../structured_memory.js');

/**
 * 结构化记忆模块测试
 * 目标：验证 AI 结构化输出解析、typed chunk 序列化、世界书条目生成的关键行为。
 */

test('parseStructuredResponse 能从 Markdown 代码块中提取 JSON 数组', () => {
    const payload = [
        {
            type: 'event',
            title: '张三在洛阳与李四决裂',
            summary: '张三在洛阳与李四公开决裂。',
            names: ['张三', '李四'],
            place: '洛阳',
            time: '第三天傍晚',
            keywords: ['决裂', '洛阳'],
            sourceRowIndex: 2,
        },
    ];

    const parsed = parseStructuredResponse(`\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``);

    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, 'event');
    assert.equal(parsed[0].names[1], '李四');
});

test('normalizeStructuredUnits 会生成稳定的 typed meta 和序列化文本', () => {
    const rowContext = {
        sourceRowIndex: 1,
        sourceTitle: '第一章总结',
        sourceNote: '主线',
        sourceContent: '张三在洛阳与李四决裂，并丢失玉佩。',
    };

    const units = normalizeStructuredUnits([
        {
            type: 'relationship',
            title: '张三与李四决裂',
            summary: '张三与李四的关系从盟友转为敌对。',
            names: ['张三', '李四'],
            place: '洛阳',
            time: '第三天傍晚',
            keywords: ['决裂', '盟友', '敌对'],
        },
        {
            type: 'item',
            title: '张三丢失玉佩',
            summary: '张三在冲突后遗失玉佩。',
            names: ['张三'],
            place: '洛阳',
            time: '第三天傍晚',
            keywords: ['玉佩', '遗失'],
        },
    ], rowContext);

    assert.equal(units.length, 2);
    assert.equal(units[0].meta.type, 'relationship');
    assert.equal(units[0].meta.primaryName, '张三');
    assert.equal(units[0].meta.relationshipTarget, '李四');
    assert.equal(units[0].meta.sourceRowIndex, 1);
    assert.match(units[0].text, /类型：关系/);
    assert.match(units[0].text, /关系对象：李四/);
    assert.match(units[0].text, /来源标题：第一章总结/);
    assert.match(units[1].text, /类型：物品/);
});

test('serializeStructuredUnit 使用固定字段顺序输出文本', () => {
    const text = serializeStructuredUnit({
        type: 'character',
        title: '张三',
        summary: '张三重伤昏迷。',
        names: ['张三'],
        place: '洛阳医馆',
        time: '第三天深夜',
        keywords: ['张三', '重伤', '昏迷'],
        sourceRowIndex: 0,
        sourceTitle: '角色状态总结',
        sourceNote: '人物',
        primaryName: '张三',
        relationshipTarget: '',
    });

    const lines = text.split('\n');
    assert.equal(lines[0], '类型：人物');
    assert.equal(lines[1], '标题：张三');
    assert.equal(lines[2], '主体：张三');
    assert.equal(lines[3], '关系对象：无');
    assert.equal(lines[4], '地点：洛阳医馆');
    assert.equal(lines[5], '时间：第三天深夜');
    assert.equal(lines[9], '来源备注：人物');
});

test('buildWorldInfoEntries 会为每个结构化单元生成独立世界书条目', () => {
    const rowContext = {
        sourceRowIndex: 3,
        sourceTitle: '主线推进',
        sourceNote: '第二章',
        sourceContent: '张三在洛阳与李四决裂。',
    };

    const [unit] = normalizeStructuredUnits([
        {
            type: 'event',
            title: '张三在洛阳与李四决裂',
            summary: '张三在洛阳公开与李四决裂。',
            names: ['张三', '李四'],
            place: '洛阳',
            time: '第三天傍晚',
            keywords: ['决裂', '洛阳', '张三'],
        },
    ], rowContext);

    const entries = buildWorldInfoEntries([unit], 10, { vectorized: true });

    assert.deepEqual(Object.keys(entries), ['10']);
    assert.equal(entries['10'].uid, 10);
    assert.equal(entries['10'].comment, '【事件】张三在洛阳与李四决裂');
    assert.equal(entries['10'].vectorized, true);
    assert.match(entries['10'].content, /类型：事件/);
    assert.match(entries['10'].content, /来源索引：3/);
    assert.equal(entries['10'].key.includes('张三'), true);
});

test('hashSummaryRow 对同一总结行生成稳定签名', () => {
    const a = hashSummaryRow({
        sourceTitle: '第一章总结',
        sourceNote: '主线',
        sourceContent: '张三在洛阳与李四决裂。',
    });
    const b = hashSummaryRow({
        sourceTitle: '第一章总结',
        sourceNote: '主线',
        sourceContent: '张三在洛阳与李四决裂。',
    });
    const c = hashSummaryRow({
        sourceTitle: '第一章总结',
        sourceNote: '主线',
        sourceContent: '张三在洛阳与王五和解。',
    });

    assert.equal(a, b);
    assert.notEqual(a, c);
});

test('reconcileStructuredBook 会按 unitHash 复用旧向量并为新条目留空', () => {
    const rowContext = {
        sourceRowIndex: 1,
        sourceTitle: '第一章总结',
        sourceNote: '主线',
        sourceContent: '张三在洛阳与李四决裂，并丢失玉佩。',
    };

    const existingUnits = normalizeStructuredUnits([
        {
            type: 'event',
            title: '张三在洛阳与李四决裂',
            summary: '张三在洛阳与李四公开争执并决裂。',
            names: ['张三', '李四'],
            place: '洛阳',
            time: '第三天傍晚',
            keywords: ['决裂', '洛阳'],
        },
    ], rowContext);

    const existingBook = {
        name: '《剧情总结归档》',
        createTime: 100,
        chunks: [existingUnits[0].text],
        vectors: [[0.1, 0.2, 0.3]],
        vectorized: [true],
        metas: [existingUnits[0].meta],
    };

    const nextUnits = normalizeStructuredUnits([
        {
            type: 'event',
            title: '张三在洛阳与李四决裂',
            summary: '张三在洛阳与李四公开争执并决裂。',
            names: ['张三', '李四'],
            place: '洛阳',
            time: '第三天傍晚',
            keywords: ['决裂', '洛阳'],
        },
        {
            type: 'item',
            title: '张三丢失玉佩',
            summary: '张三在冲突后遗失玉佩。',
            names: ['张三'],
            place: '洛阳',
            time: '第三天傍晚',
            keywords: ['玉佩', '遗失'],
        },
    ], rowContext);

    const snapshot = reconcileStructuredBook(existingBook, nextUnits, {
        fallbackName: '《剧情总结归档》',
        createTime: 200,
    });

    assert.equal(snapshot.reusedCount, 1);
    assert.equal(snapshot.chunks.length, 2);
    assert.deepEqual(snapshot.vectors[0], [0.1, 0.2, 0.3]);
    assert.equal(snapshot.vectorized[0], true);
    assert.equal(snapshot.vectors[1], null);
    assert.equal(snapshot.vectorized[1], false);
    assert.equal(snapshot.metas[1].type, 'item');
    assert.equal(snapshot.createTime, 100);
});

test('reconcileStructuredBook 在旧书没有 metas 时会安全降级', () => {
    const rowContext = {
        sourceRowIndex: 0,
        sourceTitle: '旧总结',
        sourceNote: '',
        sourceContent: '张三重伤昏迷。',
    };

    const nextUnits = normalizeStructuredUnits([
        {
            type: 'character',
            title: '张三重伤昏迷',
            summary: '张三重伤昏迷。',
            names: ['张三'],
            place: '',
            time: '',
            keywords: ['张三', '重伤'],
        },
    ], rowContext);

    const snapshot = reconcileStructuredBook({
        name: '旧书',
        createTime: 10,
        chunks: ['旧格式内容'],
        vectors: [[0.9]],
        vectorized: [true],
    }, nextUnits, {
        fallbackName: '《剧情总结归档》',
        createTime: 20,
    });

    assert.equal(snapshot.reusedCount, 0);
    assert.equal(snapshot.vectorized[0], false);
    assert.equal(snapshot.vectors[0], null);
    assert.equal(snapshot.name, '旧书');
});
