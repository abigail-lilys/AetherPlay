export interface WolfSystemVariableDefinition {
  id: number;
  name: string;
  readOnly: boolean;
}

// WOLF RPG Editor's documented numeric system-variable space currently reaches Sys163.
// Reference: https://silversecond.com/WolfRPGEditor/Help/06systemvalue.html
// SysDataBase.project is database metadata; it is not used as the live Sys variable table.
export const WOLF_SYSTEM_VARIABLE_COUNT = 164;

const DEFINITIONS: readonly [number, string, boolean][] = [
  [0, "面部图形编号", false],
  [1, "消息窗口 X 坐标", false], [2, "消息窗口 Y 坐标", false],
  [3, "选项窗口 X 坐标", false], [4, "选项窗口 Y 坐标", false],
  [5, "暂停光标 X 偏移", false], [6, "暂停光标 Y 偏移", false],
  [7, "下次选项初始位置", false], [8, "基本字体大小", false],
  [9, "消息显示速度", false], [10, "消息首字等待帧数", false],
  [11, "图片文字显示速度", false], [12, "消息显示中", true], [13, "事件执行中", true],
  [14, "显示选项窗口", false], [15, "方向键首次重复等待", false], [16, "方向键后续重复等待", false],
  [17, "选项决定音效编号", false], [18, "选项移动音效编号", false], [19, "选项取消音效编号", false],
  [20, "当前选项光标位置", true], [21, "文字阴影", false], [22, "选项光标绘制模式", false],
  [23, "注音字体大小", false], [24, "存档读取判定", true], [25, "当前存档编号", false],
  [26, "选项窗口 X 边距", false], [27, "选项窗口 Y 边距", false],
  [28, "游戏经过帧数", false], [29, "游戏经过秒数", false], [30, "游戏经过毫秒数", true],
  [31, "内部处理 FPS", true], [32, "绘制 FPS", true], [33, "帧跳过等级", false],
  [34, "角色显示 Y 修正", false], [35, "主角是否移动中", true], [36, "主角影子编号", false],
  [37, "队伍成员间距", false], [38, "键盘输入期间允许鼠标/手柄", false], [39, "键盘输入结束状态", true],
  [40, "键盘输入文字 X 坐标", false], [41, "键盘输入文字 Y 坐标", false],
  [42, "键盘输入文字抗锯齿", false], [43, "网络已下载大小", true], [44, "网络预定下载大小", true],
  [45, "网络连接速度", true], [46, "网络连接时间", true], [47, "网络剩余时间", true], [48, "网络连接状态", true],
  [52, "键盘决定键", false], [53, "键盘取消键", false], [54, "键盘辅助键", false],
  [55, "手柄决定键", false], [56, "手柄取消键", false], [57, "手柄辅助键", false],
  [59, "决定键自动连打", false], [60, "取消键自动连打", false],
  [61, "雾效编号", false], [62, "雾效 X 速度", false], [63, "雾效 Y 速度", false],
  [64, "雾效绘制类型", false], [65, "雾效不透明度", false],
  [66, "远景编号", false], [67, "远景 X 速度", false], [68, "远景 Y 速度", false],
  [71, "鼠标 X 坐标", false], [72, "鼠标 Y 坐标", false],
  [73, "文字/选项接受鼠标输入", false], [74, "显示鼠标指针", false],
  [77, "当前年份", true], [78, "当前月份", true], [79, "当前日期", true],
  [80, "当前小时", true], [81, "当前分钟", true], [82, "当前秒数", true],
  [84, "画面尺寸预设", true], [85, "绘制模式", true],
  [87, "伙伴 1 影子编号", false], [88, "伙伴 2 影子编号", false],
  [89, "伙伴 3 影子编号", false], [90, "伙伴 4 影子编号", false], [91, "伙伴 5 影子编号", false],
  [93, "当前 BGM 声像", false], [94, "当前 BGS 声像", false],
  [95, "当前 BGM 音量", false], [96, "当前 BGM 音调/频率", false],
  [97, "当前 BGS 音量", false], [98, "当前 BGS 音调/频率", false], [99, "目标 BGS 声道", false],
  [100, "BGM 音量补正", false], [101, "BGS 音量补正", false], [102, "SE 音量补正", false],
  [104, "地图 X 滚动坐标", false], [105, "地图 Y 滚动坐标", false],
  [108, "当前帧事件指令处理数", true], [110, "随机数种子", false],
  [111, "游戏窗口激活状态", true], [112, "测试游玩状态", true],
  [114, "动作版本调整值", true], [115, "WOLF 引擎版本值", true],
  [116, "游戏画面宽度", true], [117, "游戏画面高度", true], [118, "地图图块尺寸", true],
  [120, "重置历史", false], [122, "地图/事件缩放平滑", false],
  [123, "下一张图片缩放清晰显示", false], [125, "字体粗细", false],
  [127, "地图图块不写入存档", false], [129, "事件斜向移动 X 速度补正", false],
  [130, "事件斜向移动 Y 速度补正", false], [131, "主角中心 X 修正", false],
  [132, "主角中心 Y 修正", false], [134, "手柄 POV 同步方向输入", false],
  [135, "手柄左摇杆同步方向输入", false], [136, "窗口精细缩放率", false],
  [137, "窗口缩放率", false], [138, "屏幕模式", false],
  [139, "Pro 专用系统变量", true], [140, "窗口缩放绘制模式", false],
  [141, "Pro 专用系统变量", true], [143, "可用事件指令等级", true],
  [146, "DirectInput 手柄兼容模式", false], [150, "禁用特殊文字转换", false],
  [155, "角色可移动方向数量", true], [156, "角色移动幅度", true],
  [157, "横向文字压缩像素", true], [158, "换行间距", true],
  [159, "选项换行间距", true], [160, "最大地图图层数", true],
  [163, "触摸输入转换为鼠标", false],
];

export const WOLF_SYSTEM_VARIABLES: readonly WolfSystemVariableDefinition[] = Object.freeze(
  DEFINITIONS.map(([id, name, readOnly]) => Object.freeze({ id, name, readOnly })),
);

export const WOLF_SYSTEM_VARIABLE_BY_ID = new Map(
  WOLF_SYSTEM_VARIABLES.map((item) => [item.id, item] as const),
);

export const WOLF_SYSTEM_VARIABLE_READ_ONLY_IDS = new Set(
  WOLF_SYSTEM_VARIABLES.filter((item) => item.readOnly).map((item) => item.id),
);

// Unknown/reserved IDs are not writable until their semantics are documented.
export const WOLF_SYSTEM_VARIABLE_WRITABLE_IDS = new Set(
  WOLF_SYSTEM_VARIABLES.filter((item) => !item.readOnly && item.id !== 139 && item.id !== 141).map((item) => item.id),
);
