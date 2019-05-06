'use strict';
const logger = new Logger('',app.isDev());


//
logger.log('netmon started');

class Monitor{
	constructor (){
		//only for information purposes. Timestamp in ms.
		this.startTime = Date.now();

		//to get a name or something
		this.extensionManifest = chrome.runtime.getManifest();

		//statsKeys - debug / reporting thing only.
		//*some* of the keys used in this.stats (used by this.addStat) Just those repeating or... something.
		//this object has 'our' internal name, used in this.addStat, and 'real' name which later 
		//will be used to display it.
		this.statsKeys = {
			//entries remove in this.entries for any reason. Revmoing *Only* from one tab doesn't count.
			totalEntriesRemoved: 'Total entries removed (any reason)'
		};
		this.init();
	}

	//might be called multiple times (e.g. to reset):
	init(){
		//Map. all Entry objects by requestId, absolutely all entries, no dividing into tabs, with main key being
		this.entries = new Map();

		//Map of Maps - by tabId we have then a map of entries by requestID (independent from the this.entries) 
		//again, this is NOT a map to the above 'entries', it's completely independent.
		this.tabEntries = new Map();

		//Array of objects with *Ports* and criteria (like tabId), see onMessage.
		//So a single item object might be like:
		// {
		// 	port : port,
		// 	criteria: {tabId:2232}, 
		// }
		this.subscribers = [];

		//this one servers only some non-very-important information about e.g. tab title, url etc.
		this.tabs = new Tabs();

		//Indexed under tabId, some additional stuff per tab, *our* stuff, e.g. by Monitor. 
		//Like e.g. number of removed entries in a particular tab, so we can display it for a user.
		//or 'block' status.
		//not stored in the above this.tabs because it's not the Tabs class responsibility.
		this.tabsExtras = {};

		//internal log, for debugging and stuff. Consists of objects with 
		//{ message: and data: }
		//use this.log();
		this.logs = [];

		//statistics, mostly for internal (debugging) stuff, like 'total times' spent on something.
		//use this.addStat('key',numberToAdd);
		this.stats = {};
	}

	//alias for .init
	reset(){
		this.init();
	}

	run(){
		const filter = { urls: [ "<all_urls>" ] };

		//////////////////////////////////
		//tabs
		chrome.tabs.onActivated.addListener(
			(details) => {this.onTabActivated(details)});

		chrome.webNavigation.onBeforeNavigate.addListener(
			(details) => {this.onWebNavigationStart(details)});

		
		/* this one is too late
		chrome.webNavigation.onCommitted.addListener(
			(details) => {this.onWebNavigationCommitted(details)}, 
			filter);
		*/			
		//////////////////////////////////
		//requests, in the order of appearance
		chrome.webRequest.onBeforeRequest.addListener(
			(details) => {return this.onBeforeRequest(details)}, 
			filter,["requestBody","blocking"]);

		//it seems we need this one as well, even if we have onBeforeRequest, because
		//onBeforeRequest does not accept requestHeaders as an extra option, and this one - onSendHeaders
		//does not accept requestBody o.O
		//anyway, these are requests headers. Just btw: there is also onBeforeSendHeaders but we don't want it,
		//because subsequent extensions might modify stuff later. While this one here is the 'actual' one which will
		//really be sent.
		chrome.webRequest.onSendHeaders.addListener(
			(details) => {this.onSendHeaders(details)},
			filter,["requestHeaders"]);



		//onHeadersReceived i.e. response headers.
		//here we can theoretically modify the headers, which we don't want to, so we'll just
		//handle the onCompleted below.
		/*
		chrome.webRequest.onHeadersReceived.addListener(
			(details) => {this.onHeadersReceived(details)}, 
			filter,["responseHeaders"]
		);
		*/

		//end of everything I guess... i.e. onCompleted and onErrorOccurred below.
		//btw, the responseHeaders flag tells the browser to send responseHeaders which here (in onCompleted)
		//seems to be identical with those in onHeadersReceived (although maybe this changes if there are some 
		//other extensions modyfing those.)
		chrome.webRequest.onCompleted.addListener(
			(details) => {this.onCompleted(details)}, 
			filter,["responseHeaders"]);

		/**
		 * This is **not** an error from server, like 404 or 50x, it's e.g. a connection error:
		 * onErrorOccurred : Fired when a request could not be processed due to an error: for example, a lack of Internet connectivity.
		 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onErrorOccurred
		 * when this happens, the 'error' key of the `details` is defined, e.g.:
		 * error: "net::ERR_INTERNET_DISCONNECTED"
		 * first we'll get (for any given request): onBeforeRequest, then onSendHeaders, and finally onErrorOccurred.  
		 */  	
		chrome.webRequest.onErrorOccurred.addListener(
			(details) => {this.onErrorOccurred(details)}, 
			filter);

		///////////////////////////////////////////////////////////////////////////
		//communication 
		//this is established e.g. every time a user opens a browser action popup.
		//later the client probably will call 'subscribe'

		chrome.runtime.onConnect.addListener(port => {

			//called everytime a popup is opened (or full mode list)
			port.onMessage.addListener(message => {
				this.onMessage(port, message);
			})

			//called everytime a popup is closed (or full mode list)
			port.onDisconnect.addListener(something => {
				//removing subscriber (added by this.onMessage):
				for(var n in this.subscribers){
					const subscriber = this.subscribers[n];
					if(subscriber.port === port){
						this.subscribers.splice(n, 1);
						//logging only:
						let dbgTabId = 'none';
						if(subscriber.criteria && subscriber.criteria.tabId){
							dbgTabId = subscriber.criteria.tabId;
						}
						//logger.log('subscriber removed, tabId: ' + dbgTabId);
						//break;
					}
				}
			})

		});		
		
		//auto clearing
		setInterval(() => {
			this.autoClear();
		}, 1000*60);
	};

	/**
	 * called everytime user click another tab, 
	 * @param {object} details : {tabId: integer, windowId: integer}
	 */
	onTabActivated(details){
		//logger.log('onTabActivated: ', details);
		this.updateBrowserActionIcon(details.tabId);
	};

	/**
	 * updates 'browser action' icon, i.e. badge text and maybe the icon itself.
	 * @param {int}	optional tabId, if null we'll use current tab.
	 */
	updateBrowserActionIcon(tabId = null){
		if(tabId === null){
			//we need to ask about it (async).
			chrome.tabs.query({currentWindow: true, active: true},tab => {
				if(!tab[0]){
					console.error('tab[0] is undefined o.O')
					return;//impossible. Update: actually seems possible when the current window was... dev tools.
				}
				this.updateBrowserActionIcon(tab[0].id);
				return;
			});
		}		
		const tab = this.tabs.get(tabId);	
		const tabExtra = this.getTabExtra(tabId);

		let badgeText = '0';
		//title as displayed on mouse hover over the icon.
		let titleText = this.extensionManifest.name;
		if(tabExtra.blocking){
			titleText += ' (blocking) ';
		}
		if(this.tabEntries.has(tabId)){
			const theTabEntries = this.tabEntries.get(tabId);
			if(this.tabs.isOur(tabId)){
				//is this extension's tab?
				//badgeText = this.entries.size;
				badgeText = '';//ehhh, for consistency with situation below.
			}else if (!tab || !tab.url){
				//this might happen when it's *we*, our extension tab, which was opened
				//just now. Sometimes this happens, randomly
				badgeText = '';
			}else{
				//'normal' situation
				//used to add a '>' char in case there were some entries autoremoved, but it doesn't fit
				//the space.
				badgeText = theTabEntries.size;
				if(theTabEntries.size > 0){
					const lastEntry = Array.from(theTabEntries)[theTabEntries.size - 1][1];
					const tabInfo = app.isDev()?` [from tab ${tabId}]`:'';
					if(tabExtra.autoRemovedEntriesCount > 0){
						titleText += ': >';	
					}else{
						titleText += ': ';	
					}
					titleText += `${theTabEntries.size} requests${tabInfo}`;
					if(tabExtra.autoRemovedEntriesCount > 0){
						titleText += `\nNote: ${tabExtra.autoRemovedEntriesCount} oldest were removed from the list`;
					}
					titleText += `\nMost recent one: ` + utils.ellipsis(lastEntry.request.url,150);
				}
			}
		}
		chrome.browserAction.setBadgeText({ text: badgeText.toString() });
		if(!tabExtra.blocking){//NOT blocking
			chrome.browserAction.setBadgeBackgroundColor({color: '#626262'});
		}else{//Blocking
			chrome.browserAction.setBadgeBackgroundColor({color: '#b04242'});
		}
		//chrome.browserAction.setBadgeTextColor({color: '#fff'});//no such thing in chrome. Only fx.

		chrome.browserAction.setTitle({title: titleText});
		
		
		// if (timesCurrentlyDoing > 0) {
		// 	chrome.browserAction.setIcon({ path: 'static/on.gif' });
		// } else {
		// 	chrome.browserAction.setIcon({ path: 'static/off.png' });
		// }		
	}
	/**
	 * onWebNavigationStart
	 * started when user refreshes an existing tab in any way or
	 * creates a new tab (with ctrl+t or ctrl+link click)
	 * we want to remove 'old' entries from this.tabEntries but *not* from entries, so they 
	 * can still be actually available if needed.
	 * separately for every f... iframe. when frameId it's the main one.
	 * @todo - this should be configurable ('persistent' checkbox somewhere, or maybe not)
	 * 
	 * @param {object} details: {
	 * 	tabId: integer, 
	 *  frameId: 0 for the main one, positive integer for consecutive ones) 	
	 *  timeStamp : 1540666413914.113 (example) - so miliseconds from unix epoch (float?)
	 */
	onWebNavigationStart(details){
		//logger.log('onWebNavigationStart: ', details);

		//removing "old" tabEntries, i.e. older than "now".
		//thanks to that, the very next initialQuery (or any other query) to this particular tab 
		//will give only the requests following this reset.
		if(details.frameId === 0){//main frame, not some sub iframes
			if(this.tabEntries.has(details.tabId)){
				//this *could* work: this.tabEntries.delete(details.tabId);
				//but it can happen that onWebNavigationStart will fire after firstRequest. Fortunatelly
				//timestamps are telling the truth:
				const theTabEntries = this.tabEntries.get(details.tabId);
				theTabEntries.forEach((entry,key) => {
					if(entry.request && entry.request.timeStamp){
						if(entry.request.timeStamp < details.timeStamp){
							//logger.log('removing: ',entry);

							//only in the tabEntries because this is where we don't want the 'old' to show, we
							//still want them in 'general view'.
							theTabEntries.delete(key);
							//bu we'l remember in *entries* the time user navigated away, so we will remove it in some
							//point of time. readme: problem-old-entries
							const theEntry = this.entries.get(key);
							if(theEntry){
								theEntry.extra.archivedOn = Date.now();
							}
						}else{
							//logger.log('leaving alive: ',entry);
						}
					}
				})
			}
		}
		//logger.log('----end of navstart');
	};
	/* too late
	onWebNavigationCommitted(details){
		logger.log('onWebNavigationCommitted: ', details);
	}
	*/

	/** 
	 * On **all** the requests.
	 * @param {string} eventName e.g. 'onBeforeRequest
	 * @param {Entry | Object} - i.e. the Entry instance or any other object
	*/
	onWebRequest(eventName, details){
		//logger.log('on: ' +  eventName + ' : ' + (details.url || '') + ':',details);
		//if the event is onBeforeRequest (first event in the chain of given request) 
		//then exceptionally details is a whole entry. Otherwise it's just request/response headers or other
		//detail.
		let tabId = null;
		if(details instanceof Entry){
			tabId = details.request.tabId;
		}else{
			tabId = details.tabId;
		}
		this.notifySubscribers(tabId, eventName, details);
	}

	/**
	 * The moment a new 'entry' is born. 
	 * Here we actually do add an 'entry' to the list. 
	 */
	onBeforeRequest(details){
		//logger.log('onBeforeRequest for ' + details.url,details);

		//this isn't an ordinary tab, probably it's ourselves (-1) and so we don't want to pollute the lists.
		if(details.tabId <= 0){
			return;
		}
		
		const tabExtra = this.getTabExtra(details.tabId);

		const entry = new Entry();
		entry.request = details;
		if(tabExtra.blocking){
			entry.extra.blocked = true;
		}
		this.entries.set(details.requestId,entry);
		
		//and... *independly*, tabEntries.
		//first of all - do we have a `tab` collection there?
		if(!this.tabEntries.has(details.tabId)){
			this.tabEntries.set(details.tabId, new Map());
		}
		
		this.tabEntries.
			get(details.tabId).
			set(details.requestId, entry /*this.entries.get(details.requestId)*/); 

		
		//Grabbing tab information.
		//We probably already have this tab in our cache, in this case this will be a moment (sync)
		//But in case user has just opened a link in a new tab, we don't have this tab information
		//And so we'll need to do it async, by quering the tab. 
		//And only then do the onWebRequest which will notify subscribers.
		this.tabs.getOrQuery(details.tabId,tab => {
			//logger.log('...sending only now:', Date.now(), entry);
			entry.extra.tab.url = tab.url;
			entry.extra.tab.title = tab.title;
			
			//here, in contrast to the rest of the on... events, we send the *whole* entry, not only 
			//'details' (btw - it used to be like this)
			this.onWebRequest('onBeforeRequest',entry);
			
		})

		//if this request is in currently active tab, we update the icon. 
		if(details.tabId === this.tabs.getActiveTab().id){
			this.updateBrowserActionIcon(details.tabId);
		}

		this.addStat('Total requests ever reported',1);
		
		if(tabExtra.blocking === true){
			this.addStat('Total requests blocked',1);
			return {"cancel": true};
		}
	}

	//request headers.
	onSendHeaders(details){
		//logger.log('onSendHeaders',details);
		//this isn't an ordinary tab, probably it's ourselves (-1) and so we don't want to pollute the lists.
		if(details.tabId <= 0){
			return;
		}
		const entry = this.entries.get(details.requestId);
		//might be that user did 'clear' while this request was still going on.
		if(!entry){
			logger.log('no entry for ' + details.requestId + ':',details);
			return;
		}		
		entry['request']['headers'] = details.requestHeaders;
		//this.onWebRequest('onSendHeaders',details);
		this.onWebRequest('onSendHeaders',entry);
	}
	/*
	onHeadersReceived(details){
		this.onWebRequest('onHeadersReceived',details);	
	}*/

	onCompleted(details){
		//this isn't an ordinary tab, probably it's ourselves (-1) and so we don't want to pollute the lists.
		if(details.tabId <= 0){
			return;
		}
		const entry = this.entries.get(details.requestId);

		//no such thing yet (or already) not sure why but this ... happens
		//maybe it's a matter of deleting entries (clear) while there are still on going ones.
		if(!entry){
			logger.log('no entry for ' + details.requestId + ':',details);
			return;
		}			
		//this.entries[details.requestId]['response'] = details;

		//renaming 'responseHeaders' to simply 'headers' for consistency
		details['headers'] = details.responseHeaders;
		delete details['responseHeaders'];

		//setting:
		entry.response = details;
		entry.extra.time = entry.response.timeStamp - entry.request.timeStamp;

		//this.onWebRequest('onCompleted',details);
		this.onWebRequest('onCompleted',entry);
	}

	onErrorOccurred(details){
		//this isn't an ordinary tab, probably it's ourselves (-1) and so we don't want to pollute the lists.
		if(details.tabId <= 0){
			return;
		}
		const entry = this.entries.get(details.requestId);
		//no such thing yet (or already), not sure why but this ... happens
		if(!entry){
			logger.log('no entry for ' + details.requestId + ':',details);
			return;
		}	
		entry.response = details;
		entry.extra.time = entry.response.timeStamp - entry.request.timeStamp;
		//this.onWebRequest('onErrorOccurred',details);
		this.onWebRequest('onErrorOccurred',entry);
	}

	/**
	 * returns entries by search critieria
	 * @param {object} criteria
	 * 	if null, *all* entries are returned keyed by 'request_id'.
	 *  otherwise: 
	 *  criteria { 
	 *    	tabId : if not null, only the entries for given tabId are returned as a Map(!)
	 *    	requestId : if not null, only the entries for given requestId are return 
	 * 			(no problem there is both above are defined)
	 * 		useGlobal: if true, the global this.entries will be used. Along with tabId this 
	 * 			will also give 'archived' entries for given tab
	 *  }
	 * 
	 */
	query(criteria = {}){
		if(criteria == null || Object.keys(criteria).length === 0){
			return this.entries;
		}

		//this is a weird scenario - we should use 'global' this.entries but no tabId given
		//in result we also will return everything this.entries.
		if(criteria && criteria.useGlobal && !criteria.tabId){
			return this.entries;
		}
		//first phase src entries:
		let srcEntries = null;//usually map, unless nothing found then an empty object {}
		if(typeof criteria.tabId !== 'undefined'){
			//is tabId valid integer?
			console.assert(parseInt(criteria.tabId) == criteria.tabId);

			//do we want 'all' or 'current' i.e. after most recent onWebNavigationStart, from given tab?
			
			if(criteria.useGlobal){
				//we want all for given tab
				srcEntries = this.getGlobalEntriesByTabId(criteria.tabId);
			}else{
				//we want only 'current'
				srcEntries = this.tabEntries.get(parseInt(criteria.tabId));
			}
		};
		
		//even if both (requestId and tabId) are defined, that is fine, because given requestId
		//series can belong to only one tab anyway. 
		if(typeof criteria.requestId !== 'undefined'){
			srcEntries = this.entries.get(criteria.requestId);
		};

		if(typeof srcEntries === 'undefined'){
			return {};
		}
		return srcEntries;

	}

	getGlobalEntriesByTabId(tabId){
		const resultMap = new Map();
		this.entries.forEach((entry,requestId) => {
			//we use == not === because actually tabId isn't guaranteed to be int.
			if(entry.request && entry.request.tabId == tabId){
				resultMap.set(requestId,entry);
			}
		})
		return resultMap;
	}
	/**
	 * One time message from our communication port, probably a command like a query or something.
	 * setup in this.run
	 * There is also this.subscribers which receive regular messages related to requests
	 */
	onMessage(port, message){
		
		if (message.command === "subscribe"){
			/*
			logger.log('new subscriber, tabId: ' + message.tabId);
			this.tabsubscribers[message.tabId] = {
				port: port,
			};*/
			//logger.log('new subscriber:', Date.now(), message.criteria);
			this.subscribers.push({
				port : port,
				criteria: message.criteria, 
			});
		}
		if (message.command === "unsubscribe"){
			//port.onDisconnect.addListener ... somewhere here should be enough.
			/*
			if(this.tabsubscribers[message.tabId]){
				delete this.tabsubscribers[message.tabId];
			}*/
		}
		
		if (message.command === "queryEntries"){
			let entries = this.query(message.criteria || {});
			port.postMessage({
				command: 'callback', 
				callbackData: typeof message.callbackData == 'undefined'? {} : message.callbackData,
				inResponseTo: message.command,

				result: Array.from(entries), 
				errorCode: 0
			});
		}
		//stats, like internal one (this.stats) but also related to specific tab 
		//(e.g. number of auto removed entries, is blocking or not)
		if (message.command === "getExtra"){
			//let entries = this.query(message.criteria || {});
			const result = {};
			result.internalStats = this.getStats();
			result.tabExtra = {};
			if(message.criteria && message.criteria.tabId){
				result.tabExtra = this.getTabExtra(message.criteria.tabId);
			}
			port.postMessage({
				command: 'callback', 
				callbackData: typeof message.callbackData == 'undefined'? {} : message.callbackData,
				inResponseTo: message.command,

				result: result, 
				errorCode: 0
			});
		}
		//'clear' button (or clear all)
		if (message.command === 'clearEntries'){
			//for stats
			let removedCount = 0;
			//Is this clearing a specific tab only?
			if(message.criteria && message.criteria.tabId)	{
				let tabId = parseInt(message.criteria.tabId);
				//logger.log('clearing tab id: ' + tabId);
				//ensuring that really was an integer. Map seems to be strongly typed o.O
				console.assert(tabId == message.criteria.tabId);
				
				//this will get the entries from the given tab, grab their requestId and remove 
				//items this.entries by requestId and then the tabEntries itself.
				removedCount = this.removeTabEntries(tabId);
				this.updateBrowserActionIcon(tabId);
			}
			else{
				//removing absolutely everything
				//logger.log('clearing absolutely everything');
				removedCount = this.entries.size;
				this.tabEntries.clear();
				this.entries.clear();
				this.updateBrowserActionIcon();
			}
			//notifing subscribers.
			this.notifySubscribers(null,'entriesClearedNotification',{});
			//stats
			this.addStat('Entries removed by user ("clear" buttons)',removedCount)
			this.addStat(this.statsKeys.totalEntriesRemoved, removedCount);
		}

		//blocking requests
		if (message.command === 'block'){
			//are we supposed to block only specifi tab?
			if(message.criteria && message.criteria.tabId)	{
				this.getTabExtra(message.criteria.tabId).blocking = true;
				this.updateBrowserActionIcon(message.criteria.tabId);//just to reflect this
				logger.log('blocking ' + message.criteria.tabId);
			}
		}
		//unblocking requests
		if (message.command === 'unblock'){
			//are we supposed to unblock only specifi tab?
			if(message.criteria && message.criteria.tabId)	{
				this.getTabExtra(message.criteria.tabId).blocking = false;
				this.updateBrowserActionIcon(message.criteria.tabId);//just to reflect this
				logger.log('unblocking ' + message.criteria.tabId);
				
			}
		}		
	}

	/**
	 * 
	 * @param {} tabId : target tabId or an array of tabIds. If null, it won't be considered 
	 * a filter (i.e. all listeners will get the message)
	 * 
	 * @param {string} eventName : e.g. onCompleted, onSendHeaders, but also custom like 'entriesClearedNotification'
	 * 
	 * @param {object} details : event's details, e.g. if it's 'onCompleted' it's the details posted by
	 * chrome.webRequest.onCompleted.addListener. In case of custom events, this can be anything.
	 */
	notifySubscribers(tabId, eventName, details = {}){
		//isTabId an array?
		if(tabId !== null && typeof tabId === 'object' && typeof tabId.length !== 'undefined'){
			tabId.forEach((ti) => {
				this.notifySubscribers(ti,eventName, details = {});
			})
			return;
		}
		for(var n in this.subscribers){
			const subscriber = this.subscribers[n];
			const port = subscriber.port;
			let criteriaMatches = true;

			//tabId filtering?
			if(tabId !== null && subscriber.criteria &&
				typeof subscriber.criteria.tabId !== 'undefined' 
				&& subscriber.criteria.tabId != tabId
				){
				criteriaMatches = false;
			}
			
			if(criteriaMatches){
				try{
					port.postMessage({
						command: 'subscription', 
						eventName: eventName,
						details: details,
					});
				}catch(error){
					//logger.log('error with port.postMessage: ',error, ' subscribed removed');
					//most probably 'disconnected port' or similar, removing.
					delete this.subscribers[n];
				}					
			}
		}
	}

	/**
	 * Removes given whole tab from both this.tabEntries and entries in this.entries matching given tabId
	 * Used when a command is send "clearEntries" specific to given tab or when autoclearing old closed tabs.
	 * @return int  - number of entries removed.
	 */
	removeTabEntries(tabId){
		//only for informational purposes:
		let count = 0;
		//easy - removing from tabEntries
		if(this.tabEntries.has(tabId)){
			count += this.tabEntries.get(tabId).size;
			this.tabEntries.delete(tabId);
		}
		//harder - we need to find all the matching entries in this.entries.
		//previously we used to take that info (what to delete) from tabEntries but that wasn't sufficient
		//because for many reasons this information might not be up to date.
		this.entries.forEach((entry,requestId) => {
			if(entry.request && entry.request.tabId === tabId){
				this.entries.delete(requestId);
				count++;
			}
		})		
		return count;
	};

	/**
	 * Using this.tabExtras returns a matching tab info or (if missing) creates and returns it.
	 * @param {*} tabId 
	 */
	getTabExtra(tabId){
		if(tabId in this.tabsExtras){
			return this.tabsExtras[tabId];
		}
		//there can be more than this, it's dynamic
		this.tabsExtras[tabId] = {
			autoRemovedEntriesCount : 0,
		}
		return this.tabsExtras[tabId];
	}
	/**
	 * Part of auto clearing. Used in this.autoClear which is called periodically
	 * @param {int} maxEntriesPerTab - max entries per tab, if found a bigger one, then removing is done.
	 * 				We'll remove at least so many elements, that we'll reach this max
	 * @param {int} removeCountBelowMax - if any tab found higher that the max, then, since we are at this, 
	 * 				how many *more* elements should we remove, so we will not get into this process to often.
	 * 
	 * @return {array} array of tab ids which were "cleared"
	 */
	clearOversizedTabs(maxEntriesPerTab, removeCountBelowMax = 1){
		let clearedTabs = [];
		this.tabEntries.forEach((theTabEntries, tabId) => {
			if(theTabEntries.size > maxEntriesPerTab){
				const requestsIds = theTabEntries.keys();
				let index = 0;
				//so if the max is 10 and we have 15, then well remove 5 plus removeCountBelowMax
				let removeCount = (theTabEntries.size - maxEntriesPerTab) + removeCountBelowMax;
				//logger.log('clearing ' + removeCount + ' in ' + tabId);
				for (let requestId of requestsIds) {
					theTabEntries.delete(requestId);
					this.entries.delete(requestId);
					if(++index >= removeCount){
						break;
					}
				}		
				this.addStat('Clearing oversized tabs: removed entries', removeCount);
				//we use this.statsKeys... because this particular key is used more than once:
				this.addStat(this.statsKeys.totalEntriesRemoved, removeCount);
				//some extra info per tab
				const tabExtra = this.getTabExtra(tabId);
				tabExtra.autoRemovedEntriesCount += removeCount;
				clearedTabs.push(tabId); 		
			}
		})
		return clearedTabs;
	}

	/**
	 * this one will remove those entries which a. belong to closed tabs (those which simply do not 
	 * exists any more) and b. are older than 'maxInactivityTime' minutes 
	 * 
	 * @param {int} maxInactivityTime - when (in minutes) to consider a tab for deletion 
	 * 	(how old the most recent request must be). 0 (zero) means *all* the closed tabs (and their entries)
	 * should be removed.
	 * 
	 * @return array of removed tabs id.
	 */
	clearClosedTabs(maxInactivityTime = 60){
		let clearedTabs = [];
		this.tabEntries.forEach((theTabEntries, tabId) => {
			if(!this.tabs.is (tabId)){//the tab doesn't exist anymore
				const theTabEntriesSize =  theTabEntries.size;
				if(theTabEntriesSize > 0){
					//last entry on the list (in the insertion order). The [1] here is because we want 'value' (entry)
					//[0] is the key which we're not interested in.
					const lastEntry = Array.from(theTabEntries)[theTabEntries.size - 1][1];
					const lastEntryAgeMinutes = (Date.now() -  lastEntry.request.timeStamp) / 1000 / 60;
					if(lastEntryAgeMinutes >= maxInactivityTime){
						//logger.log(`removing from tab ${tabId} aged ${lastEntryAgeMinutes} min. url: ${lastEntry.extra.tab.url}`);
						this.removeTabEntries(tabId);

						this.addStat('Clearing closed tabs: removed entries', theTabEntriesSize);
						this.addStat('Clearing closed tabs: removed tabs', 1);
						//we use this.statsKeys... because this particular key is used more than once:

						this.addStat(this.statsKeys.totalEntriesRemoved, theTabEntriesSize);
						clearedTabs.push(tabId); 	
					}
				}
			}
		});		
		return clearedTabs;
	}

	/**
	* problem: when user navigates away from a given site (but doesn't close a tab) we still keep
	* the info in this.entries - because user might want to see them in 'global scope'.
	* but by doing so, we risk that the data will become huge, in case user doesn't close the tab
	* readme: problem-old-entries
	* @param maxTime - in minutes
	* @return - count of removed entries.
	*/
	clearArchivedEntries(maxTime = 60){
		let count = 0;
		this.entries.forEach((entry,requestId) => {
			if(typeof entry.extra.archivedOn != 'undefined' && entry.extra.archivedOn !== null){
				const entryArchivedAgeMinutes = (Date.now() -  entry.extra.archivedOn) / 1000 / 60;
				if(entryArchivedAgeMinutes > maxTime){
					this.entries.delete(requestId);
				}
				count++;
			}
		})	
		this.addStat('Clearing archived tabs: removed entries', count);
		//we use this.statsKeys... because this particular key is used more than once:
		this.addStat(this.statsKeys.totalEntriesRemoved, count);	
		return count;	
	}
	/**
	 * This one should never actually be needed. And the name says its all.
	 * @return bool true if anything was removed, false if there was no need.
	 * @todo we should also remove them in tabEntries probably... 
	*/
	clearRidiculouslyHighNumberOfGlobalEntries(maxEntries = 100000){
		if(this.entries.size < maxEntries){
			return false;
		}
		const removeCount = (this.entries.size - maxEntries) + (maxEntries * 0.1);
		utils.deleteMapHead(this.entries, removeCount);

		//this.log('clearRidiculouslyHighNumberOfGlobalEntries - cleared general log (all tabs)',{removeCount: removeCount});

		this.addStat('clearRidiculouslyHighNumberOfGlobalEntries: removed entries', removeCount);
		//we use this.statsKeys... because this particular key is used more than once:
		this.addStat(this.statsKeys.totalEntriesRemoved, removeCount);
		return true;
	}

	/**
	 * In case we get too fat (too many requests recorded), here we're removing older entries.
	 * We are called here every few seconds.
	 */
	autoClear(){
		const startTime = performance.now();

		//if any tab has more than x items, remove the overhead and a few more:
		//this should be optional
		const limitPerTab = 1500;
		let clearedTabs = this.clearOversizedTabs(limitPerTab, limitPerTab * 0.1);
		if(clearedTabs.length > 0){
			//send notification to the affected tabs:
			this.notifySubscribers(clearedTabs,'entriesAutoClearedNotification');
			//this action could affect current tab stats, which we do display as browser action badge text.
			this.updateBrowserActionIcon();
			this.log(`autoClear: done clearOversizedTabs (${clearedTabs.length}) tabs cleaned`);
		}

		//when to consider a tab a candidate for a complete deletion. In in minutes since the last
		//time it was alive. 60 minutes should be fine. This is the time user still can still analyze
		//the traffic even after closing a tab.
		const maxInactivityTime = 60;
		let clearedClosedTabs = this.clearClosedTabs(maxInactivityTime);
		if(clearedClosedTabs.length > 0){
			//send notification to the affected tabs:
			this.notifySubscribers(clearedClosedTabs,'entriesAutoClearedNotification');
			this.log(`autoClear: done clearClosedTabs (${clearedClosedTabs.length}) tabs cleaned`);
		}

		//if there still is a problem, we'll remove the 'archived' entries. readme: problem-old-entries
		if(this.entries.size > 3000){
			let maxArchivedTime = 60;
			let clearedArchivedEntriesCount = this.clearArchivedEntries(maxArchivedTime);
			this.log(`autoClear: done clearArchivedEntries (${clearedArchivedEntriesCount}) entries removed`);

		}		
		//if for any reason the main tab-agnostic this.entries map also have a ridiculously large number of 
		//items. This should actually never happen.
		const limitGlobal = 100000;
		if(this.clearRidiculouslyHighNumberOfGlobalEntries(limitGlobal)){
			//send notification to all the tabs:
			this.notifySubscribers(null,'entriesAutoClearedNotification');
			this.log(`autoClear: done clearRidiculouslyHighNumberOfGlobalEntries`);
		}
		
		this.addStat('Auto clearing: total time spent (ms)', performance.now() - startTime);
	};

	/**
	 * internal log
	 * @param {string | object} message - a message or a whole object
	 * @param {object} data : optional additional data
	 */
	log(message, data = {}){
		let log = {};
		if(typeof message === 'object'){
			log = message;
		}else{
			log = {
				message: message,
				data: data,
			};
		}
		log.timeStamp = Date.now();
		//logger.log('internal log:', log);
		this.logs.push(log);
	}

	/**
	 * Adding a value (number) to internal stats
	 * @param {string} key 
	 * @param {number} numberToAdd 
	 */
	addStat(key, numberToAdd){
		if(key in this.stats === false){
			this.stats[key] = 0;
		}
		this.stats[key] += numberToAdd;
	}
	/**
	 * Internal stats - i.e. this.stats plus some other things
	 */
	getStats(){
		const result = this.stats;
		result['Currently: entries'] = this.entries.size;
		result['Currently: tabs in tab entries'] = this.tabEntries.size;
		result['Currently: entries in tab entries'] = Array.from(this.tabEntries).
			reduce((acc,item) => {
				return acc + item[1].size;
			},0);
		result['Currently: active tabs'] = Object.keys(this.tabs.tabs).length;
		result['Currently: subscribers'] = this.subscribers.length;
		//total time since we started, *not* "time spent on processing"
		result['Currently: minutes since start'] = (Date.now() - this.startTime) / 1000 / 60;
		return result;
	}
}

const monitor = new Monitor();
monitor.run();

/**
 * this one is different than the Monitor::onMessage. The latter is based on a port and this one here
 * is just a one time message, mostly for debug purposes.
 */
chrome.runtime.onMessage.addListener(
  function(message, sender, sendResponse) {
	//console.log on behalf of something else, like browser action popup (to make it easier on chrome)
	if(message.command == "logPlease"){
		logger.log('from ' + message.from + ':');
		logger.log(message.param);
	}

});

