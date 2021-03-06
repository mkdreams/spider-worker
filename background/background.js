window.spiderSlaveTabInfos = { 'locked': false, 'api': {}, 'tabs': {} };
window.spiderSlaveUrls = {};
window.setInterval_getHtml = {};
window.setInterval_waitToComplete = {};
window.setTimeout_checkIsDie = {};
window.tabUrlIds = {};
window.baseWindow = undefined;

function enabledProxy() {
	disabledProxy();
	$.ajax({
		url: window.spiderProxyFetchApi,
		cache: false,
		success: function (html) {
			var proxysTemp = html.split("\r\n");
			chrome.storage.local.get(['proxys'], function (proxys) {
				if (Object.keys(proxys).length == 0) {
					proxys = [];
				} else {
					proxys = proxys.proxys;
				}
				proxysTemp.forEach(function (v) {
					if (v != '') {
						proxys.push(v);
					}
				});

				chrome.storage.local.set({ 'proxys': proxys });
				console.log(proxysTemp, proxys);
			});
		}
	});

	var config = {
		mode: "pac_script",
		pacScript: {
			data: "function FindProxyForURL(url, host) {\n" +
				"  alert(url);\n" +
				"  if (host == 'www.baidu.com')\n" +
				"    return 'PROXY 127.0.0.1:1080';\n" +
				"  return 'DIRECT';\n" +
				"}"
			, mandatory: true
		}
	};

	chrome.proxy.settings.set(
		{
			value: config,
			scope: 'regular'
		},
		function (config) {
		}
	);
}

function disabledProxy() {
	var config = {
		mode: "system"
	};

	chrome.proxy.settings.set(
		{
			value: config,
			scope: 'regular'
		},
		function (config) {

		}
	);
}

var windowLeftOffset = 0;
var windowTopOffset = 0;
function createTab(url, callback, useBaseWindow) {
	var createOneTab = function (newWin, tabId) {
		var tabOption = { 'url': url };
		if (newWin) {
			tabOption['windowId'] = newWin.id;
		}

		if (tabId) {
			chrome.tabs.get(tabId, function (tab) {
				//chrome://discards/ 
				chrome.tabs.update(tab.id, { autoDiscardable: false }, function () {
					callback && callback(tab,newWin);
				});
			});
		} else {
			chrome.tabs.create(tabOption, function (tab) {
				//chrome://discards/ 
				chrome.tabs.update(tab.id, { autoDiscardable: false }, function () {
					callback && callback(tab,newWin);
				});
			});
		}
	}

	if (useBaseWindow) {
		createOneTab();
	} else {
		windowLeftOffset += window.baseInfo['perWidth'];
		if (windowLeftOffset + window.baseInfo['perWidth'] - 10 >= window.baseInfo['width']) {
			windowLeftOffset = 0;
			windowTopOffset += window.baseInfo['perHeight'];
		}

		console.log({ focused: true, state: 'normal', 'url': url, top: windowTopOffset, left: windowLeftOffset, height: window.baseInfo['perHeight'], width: window.baseInfo['perWidth'] })

		chrome.windows.create({ focused: true, state: 'normal', 'url': url, top: windowTopOffset, left: windowLeftOffset, height: window.baseInfo['perHeight'], width: window.baseInfo['perWidth'] }, function (newWin) {
			console.log('newWin', newWin);
			createOneTab(newWin, newWin.tabs.length > 0 ? newWin.tabs[0]['id'] : 0);
		});
	}
}

function workPlay() {
	workPause();

	chrome.tabs.onRemoved.addListener(function (tabId) {
		clearTimeout(window.setTimeout_checkIsDie[window.spiderSlaveTabInfos['tabs'][tabId].id]);
		clearInterval(window.setInterval_getHtml[window.spiderSlaveTabInfos['tabs'][tabId].id]);
		clearInterval(window.setInterval_waitToComplete[window.spiderSlaveTabInfos['tabs'][tabId].id]);
		delete window.spiderSlaveTabInfos['tabs'][tabId];
		console.log('close tab!', tabId);
	});

	clearInterval(window.setInterval_getHtmlRun);
	window.setInterval_getHtmlRun = setInterval(function () {
		if (Object.keys(window.spiderSlaveUrls).length > 0) {
			oneActionRun();
		}
	}, window.spiderSlaveDelay);

	clearInterval(window.setInterval_getLinksCache);
	window.setInterval_getLinksCache = setInterval(function () {
		if (Object.keys(window.spiderSlaveUrls).length == 0) {
			sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 1, 'url': window.spiderSlaveApiActionList, 'data': { 'sFlag': window.spiderSlaveFlag } });
		}
	}, window.spiderSlaveGetUrlsDelay);
	backgroundConsole('已开始', 1);
}

function workPause() {
	clearInterval(window.setInterval_getHtmlRun);
	clearInterval(window.setInterval_getLinksCache);
	backgroundConsole('已暂停', 1);
}

function getNextTab() {
	var index = -1;//all is busy
	var tabLen = 0;
	for (var i in window.spiderSlaveTabInfos['tabs']) {
		tabLen++;
		if (window.spiderSlaveTabInfos['tabs'][i]['runStatus'] == 1) {
			continue;
		}

		index = i;
		break;
	}

	//need create tab
	if (index == -1 && tabLen < window.spiderSlaveTabCount) {
		return -2;
	}

	return index;
}

function getUrlInfo(types) {
	var nowTimeStamp = new Date().getTime();
	var needAgain = nowTimeStamp - 300000;
	for (var id in window.spiderSlaveUrls) {
		//js 阻塞式运行
		if (window.spiderSlaveUrls[id]['type'] == 100) {
			if ((!types || types.indexOf(window.spiderSlaveUrls[id]['type']) > -1)
				&& (!window.spiderSlaveUrls[id]['runStartTime'] || window.spiderSlaveUrls[id]['runStartTime'] < needAgain)) {
				window.spiderSlaveUrls[id]['runStartTime'] = nowTimeStamp;
				return id;
			} else {
				return -2;
			}
		}

		if (window.spiderSlaveUrls[id]
			&& (!types || types.indexOf(window.spiderSlaveUrls[id]['type']) > -1)
			&& (!window.spiderSlaveUrls[id]['runStartTime'] || window.spiderSlaveUrls[id]['runStartTime'] < needAgain)
		) {
			window.spiderSlaveUrls[id]['runStartTime'] = nowTimeStamp;
			return id;
		}
	}

	return -1;
}


function isDone(tab, info) {
	window.spiderSlaveTabInfos['tabs'][tab.id]['runStatus'] = 0;
	delete window.spiderSlaveUrls[info['id']];
	clearTimeout(window.setTimeout_checkIsDie[tab.id]);
}

//try every 50 ms
function getHml(tab, info) {
	clearInterval(window.setInterval_getHtml[tab.id]);
	window.setInterval_getHtml[tab.id] = setInterval(function () {
		sendMessageToTabs(tab, { 'actiontype': 1, 'info': info }, function (res) {
			if (res && res['scrollIsEnd'] == true) {
				clearInterval(window.setInterval_getHtml[tab.id]);
				if (res && res['html']) {
					sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 2, 'tab': tab, 'url': window.spiderSlaveApiCb, 'data': { 'id': info['id'], 'sResponse': res.html } });
				}
				isDone(tab, info);
			}
		});
	}, 50);
}

function dealOneAction(tab, info, needJump) {
	// 1:a(jump and get data)
	//2:js,4:css,8:image,16:others(ajax get data by get method)
	//100:block run js,101:ajax,
	//102:a without scroll
	//201:open the url,then read this url's cookies form the browser
	var typesToName = { 
		1: "a", 
		2: "js", 
		4: "css", 
		8: "image", 
		16: "others", 
		100: "run js block until all complete", 
		101: "ajax", 
		102: "a without scroll",
		103: "a by click",
		201: "get cookies"
	};

	actionRecords(info['url'], typesToName[info['type']]);

	if (!needJump) {//jump
		sendMessageToTabs(tab, { 'actiontype': 2, 'info': info });
	}

	window.tabUrlIds[tab.id] = info['id'];

	// if (info.type == 100) {
	// 	setTimeout(function () {
	// 		sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 2, 'tab': tab, 'url': window.spiderSlaveApiCb, 'data': { 'id': info['id'], 'sResponse': '' } });
	// 		isDone(tab, info);
	// 	}, 1000);
	// } else 
	if (info.type == 1 || info.type == 102 || info.type === 201) {
		setTimeout(function () {
			clearInterval(window.setInterval_waitToComplete[tab.id]);
			window.setInterval_waitToComplete[tab.id] = setInterval(function (callback) {
				chrome.tabs.get(tab.id, function (nowTab) {
					backgroundConsole('tab info', nowTab.status);
					if (nowTab.status == 'complete') {
						clearInterval(window.setInterval_waitToComplete[tab.id]);
						if (info.type === 1) {
							//scroll 
							sendMessageToTabs(nowTab, { 'actiontype': 3, 'info': info });
							getHml(nowTab, info);
						}else if(info.type === 201){
							eval('backgroundAction'+info.type+'(tab, info);');
						}else{
							getHml(nowTab, info);
						}
					}
				});
			}, 50);
		}, 50);
	}else{
		setTimeout(function () {
			getHml(tab, info);
		}, 50);
	}
}


function oneActionRun() {
	var urlId = getUrlInfo();
	var tabId = getNextTab();

	//wait 
	if (urlId == -2) {
		return;
	}

	//create one tab
	if (tabId == -2) {
		if (window.spiderSlaveTabInfos['locked']) {
			window.spiderSlaveUrls[urlId]['runStartTime'] = 0;
			return;
		}

		window.spiderSlaveUrls[urlId]['runStartTime'] = 0;
		var urlId = getUrlInfo([1, 102, 201]);//get one a,or get cookies url
		if (urlId == -1) {
			sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 1, 'url': window.spiderSlaveApiActionList, 'data': { 'sFlag': window.spiderSlaveFlag } });
			return;
		}

		//wait 
		if (urlId == -2) {
			return;
		}

		window.spiderSlaveTabInfos['locked'] = true;
		createTab(window.spiderSlaveUrls[urlId]['url'], function (tab,newWin) {
			window.spiderSlaveTabInfos['tabs'][tab.id] = tab;
			window.spiderSlaveTabInfos['tabs'][tab.id]['runStatus'] = 1;
			window.spiderSlaveTabInfos['tabs'][tab.id]['win'] = newWin;
			window.spiderSlaveTabInfos['locked'] = false;
			dealOneAction(window.spiderSlaveTabInfos['tabs'][tab.id], window.spiderSlaveUrls[urlId], true);
		});
		return;
	}

	//get more actions
	if (urlId == -1) {
		sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 1, 'url': window.spiderSlaveApiActionList, 'data': { 'sFlag': window.spiderSlaveFlag } });
		return;
	}


	//now tab is runing 
	if (tabId < 0 || window.spiderSlaveTabInfos['tabs'][tabId]['runStatus'] == 1) {
		window.spiderSlaveUrls[urlId]['runStartTime'] = 0;
		return;
	}

	//mark this tab,that is runing
	window.spiderSlaveTabInfos['tabs'][tabId]['runStatus'] = 1

	//try agin after 3min
	clearTimeout(window.setTimeout_checkIsDie[window.spiderSlaveTabInfos['tabs'][tabId].id]);
	window.setTimeout_checkIsDie[window.spiderSlaveTabInfos['tabs'][tabId].id] = setTimeout(function () {
		window.spiderSlaveTabInfos['tabs'][tabId]['runStatus'] = 0;
		clearInterval(window.setInterval_getHtml[window.spiderSlaveTabInfos['tabs'][tabId].id]);
		clearInterval(window.setInterval_waitToComplete[window.spiderSlaveTabInfos['tabs'][tabId].id]);
		console.log('time out!', info);
	}, 180000);


	if(window.spiderSlaveHumanBehavior) {
		// $.ajax({
		// 	type: 'POST',
		// 	url: window.spiderSlaveHumanBehaviorApi,
		// 	data: {'x':100,'y':200},
		// 	success: function(data){
				
		// 	},
		// });
		dealOneAction(window.spiderSlaveTabInfos['tabs'][tabId], window.spiderSlaveUrls[urlId]);
	}else{
		dealOneAction(window.spiderSlaveTabInfos['tabs'][tabId], window.spiderSlaveUrls[urlId]);
	}
}

//api tab interface
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
	var tab = sender.tab;
	switch (req.type) {
		//send html to api tab
		case 3:
			if (window.tabUrlIds[tab.id]) {
				sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 2, 'tab': tab, 'url': window.spiderSlaveApiCb, 'data': { 'id': window.tabUrlIds[tab.id], 'sResponse': req.html } });
				window.tabUrlIds[tab.id] = undefined;
			}
			break;

		//push url
		case 2:
			if (!(req.data.data instanceof Array)) {
				break;
			}
			req.data.data.forEach(function (v) {
				if (!window.spiderSlaveUrls[v['id']]) {
					window.spiderSlaveUrls[v['id']] = v;
				}
			});
			break;
		default:
			break;
	}
})

function debugRun(type, url) {
	window.spiderSlaveUrls['debug'] = { "id": "debug", "url": url, "type": type, "code": "debug" };
	console.log(window.spiderSlaveUrls);
	oneActionRun();
}

//background console.log to api tab
function backgroundConsole(pre, obj) {
	sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 3, 'obj': [pre, obj] });
}

function backgroundAction201(tab, info) {
	chrome.cookies.getAll({'url':info.url},function(cookies) {
		textToBase64(JSON.stringify(cookies),function(base64){
			sendMessageToTabs(window.spiderSlaveTabInfos['api'], { 'admintype': 2, 'tab': tab, 'url': window.spiderSlaveApiCb, 'data': { 'id': info['id'], 'sResponse': base64 } });
			isDone(tab, info);
		});
	});

}

function actionRecords(message, title) {
	if (title == undefined) {
		var title = '当前事件';
	}

	chrome.notifications.clear('notify_tips', function () {
		chrome.notifications.create(
			'notify_tips', // notifyId
			{ "type": "basic", "iconUrl": "popup/images/colin.png", "title": title, "message": message },
			function (notifyId) {

			}
		);
	});
}