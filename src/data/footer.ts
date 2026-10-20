import wechatIcon from '../assets/social/wechat.svg';
import bilibiliIcon from '../assets/social/bilibili.svg';
import douyinIcon from '../assets/social/douyin.svg';
import douyinCode from '../assets/social/douyin-code.svg';
import accounts from './social-accounts.json';

export const snc = {
	name: accounts.displayName,
	website: 'https://snc.moe/',
	about: 'https://youth.buct.edu.cn/2018/0303/c1148a8484/pagem.htm',
	join: '',
	slogan: ['技术', '激情', '协作', '创新'],
	introduction: [
		'学生网络中心（SNC）成立于2001年4月，是北京化工大学首批第二课堂人才培养基地、首批大学生创新基地。建设运营的“胜古朝阳”于2014、2015年连续获评“全国高校百佳网站”，“烟花三月”活动曾与30余所高校合作。',
		'学生网络中心始终致力于学生综合素质与创新能力的培养，为热爱技术与创造的同学提供实践与成长的平台。',
	],
};

export const university = {
	website: 'https://www.buct.edu.cn/',
	map: 'https://www.buct.edu.cn/xydt/list.htm',
	address: '北京市朝阳区北三环东路15号',
};

export const serviceStatusUrl = 'https://up.ccsn.dev/';
export const contentLicenseUrl = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';

export interface FooterLink {
	name: string;
	href?: string;
	feedback?: boolean;
}

export interface FooterLinkGroup {
	name: string;
	separated?: boolean;
	links: FooterLink[];
	more?: FooterLink;
}

// Leave href empty until a destination is ready. Empty groups are omitted.
export const footerLinkGroups: FooterLinkGroup[] = [
	{
		name: '本站',
		links: [
			{ name: '关于本站', href: '/序/' },
			{ name: '网址导航', href: '/nav/' },
			{ name: '标签索引', href: '/tags/' },
		],
	},
	{
		name: '参与共建',
		links: [
			{ name: '参与编辑', href: 'https://github.com/BUCT-WIKI/buct-wiki-content' },
			{ name: '内容反馈', feedback: true },
		],
	},
	{
		name: 'SNC 服务',
		separated: true,
		links: [{ name: 'X-Ware' }],
		more: { name: '更多 SNC 服务与网站' },
	},
	{
		name: '友情链接',
		separated: true,
		links: [
			{ name: '北京化工大学', href: university.website },
			{ name: '学生工作办公室', href: 'https://xgb.buct.edu.cn/' },
		],
	},
];

const bilibiliUrl = `https://space.bilibili.com/${accounts.bilibili.uid}`;

export const socialAccounts = [
	{
		id: 'wechat',
		name: '微信公众号',
		identifier: `微信号：${accounts.wechat.handle}`,
		href: accounts.wechat.qrUrl,
		icon: wechatIcon,
		code: { kind: 'qr', value: accounts.wechat.qrUrl },
		codeName: '微信公众号二维码',
		hint: '在微信中扫描或识别二维码',
	},
	{
		id: 'bilibili',
		name: '哔哩哔哩',
		identifier: `UID：${accounts.bilibili.uid}`,
		href: bilibiliUrl,
		icon: bilibiliIcon,
		code: { kind: 'qr', value: bilibiliUrl },
		codeName: '哔哩哔哩二维码',
		hint: '扫码打开主页',
	},
	{
		id: 'douyin',
		name: '抖音',
		identifier: `抖音号：${accounts.douyin.handle}`,
		href: accounts.douyin.profileUrl,
		icon: douyinIcon,
		// Native Douyin codes must come from the account's official sharing image.
		code: { kind: 'asset', value: douyinCode.src },
		codeName: '抖音码',
		hint: '打开抖音搜索页，使用扫一扫',
	},
] as const;
