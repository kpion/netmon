'use strict';
const logger = new Logger('',app.isDev());


//
logger.log('netmon started');

/**
 * As *current* as possible state of all tabs opened in all windows.
 * 
 * Made for quick access for tab info, without quering the browser every single time 
 * (with chrome.tabs.query or similar).
 * 
 * 
 */
class Tabs{

	constructor(){

		//all the info as it is when doing chrome.tabs.query({}...)
		//indexed under tab.id
		//we don't want new Map, because we don't care about the order and other features.
		this.tabs = {};
		this.updateAll();
		chrome.webNavigation.onBeforeNavigate.addListener((details) => {
			if(details.frameId === 0){//main frame, not some sub iframes
				this.update(details.tabId);//btw, only a fraction shorter than simply this.updateAll
			}
		});

		chrome.webNavigation.onTabReplaced.addListener((details) => {
			this.updateAll();//only a few miliseconds for 20 tabs on not-so-decent cpu, no worries
		});
		chrome.tabs.onRemoved.addListener((details) => {
			this.updateAll();//only a few miliseconds for 20 tabs on not-so-decent cpu, no worries
		});
	}
	/**
	 * removes and then re-adds all tabs info. Async.
	 */
	updateAll(callback = null){
		chrome.tabs.query({},tabs => {
			//removing old
			this.tabs = {};
			tabs.forEach(tab => {
				this.tabs[tab.id] = tab;
			});
			if(callback){
				callback();
			}
		});;
	}

	/**
	 * updates one tab in our cache, plus calls a callback with the fresh info. 
	 * usage: .update(111,tab => {...just one tab object...})
	 */
	update(tabId, callback = null){
		chrome.tabs.get(tabId, tab=>{
			this.tabs[tabId] = tab;
			if(callback){
				callback(tab);
			}
		});
	}
	/**
	 * 
	 * true if we have this tab id. Not really needed, but meh.
	 */
	is(tabId){
		return tabId in this.tabs;
	}	

	/**
	 * returns given tab in our *cache*, or null if missing.
	 * will not query the browser for this info.
	 */
	get(tabId){
		if(tabId in this.tabs === false) {
			return null;
		}
		return this.tabs[id];
	}

	/**
	 * gets (via callback!) a tab info from the our cache and if not found, queries 
	 * the browser for it and stores in cache for future reference.
	 * A tab could be not in the cache when e.g. appeared recently
	 * usage: .getOrQuery(111,tab=>{...tab is a single object...});
	 */
	getOrQuery(tabId, callback){
		let existing = this.get(tabId);
		if(existing){
			if(callback){
				callback(existing);
			}
			return;
		}
		//there is none like this, might be removed, or maybe it has just appeared recently
		//this one will query the browser and update our cache. And call the callback.
		this.update(tabId, callback);
	}
}

class Monitor{
	constructor (){
		this.init();
	}

	//might be called multiple times (e.g. to reset):
	init(){
		//Map. all Entry objects by requestId, absolutely all entries, no dividing into tabs, with main key being
		this.entries = new Map();

		//Map of Maps - by tabId we have then a map of entries by requestID (independent from the this.entries) 
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

		//internal log, for debugging and stuff. Consists of objects with 
		//{ message: and data: }
		//use this.addInternalLog();
		this.internalLog = [];
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
			(details) => {this.onBeforeRequest(details)}, 
			filter,["requestBody"]);

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
						delete this.subscribers[n];
						//logging only:
						let dbgTabId = 'none';
						if(subscriber.criteria && subscriber.criteria.tabId){
							dbgTabId = subscriber.criteria.tabId;
						}
						logger.log('subscriber removed, tabId: ' + dbgTabId);
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
	 * started everytime user click another tab, 
	 * @param {object} details : {tabId: integer, windowId: integer}
	 */
	onTabActivated(details){
		//logger.log('onTabActivated: ', details);
	};

	/**
	 * onWebNavigationStart
	 * started when user refreshes an existing tab in any way or
	 * creates a new tab (with ctrl+t or ctrl+link click)
	 * separately for every f... iframe. when frameId it's the main one.
	 * @todo - this should be configurable ('persistent' checkbox somewhere)
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
	//On **all** the requests.
	onWebRequest(eventName, details){
		//logger.log('on: ' +  eventName + ' : ' + (details.url || '') + ':',details);
		/*
		for(var n in this.subscribers){
			const subscriber = this.subscribers[n];
			const port = subscriber.port;
			let criteriaMatches = true;
			if(subscriber.criteria && 
				typeof subscriber.criteria.tabId !== 'undefined' 
				&& subscriber.criteria.tabId != details.tabId
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
		}//end of looping subscribers
		*/
		this.notifySubscribers(details.tabId, eventName, details);
	}

	/**
	 * Here we actually do add an 'entry' to the list. 
	 */
	onBeforeRequest(details){
		//logger.log('onBeforeRequest for ' + details.url,details);
		//tests:
		/*
		//this was a thing in firefox, seems to be vanished.
		if(details.requestId.toString().indexOf('fakeRequest') != -1){
			logger.log('fake found!: ' +  'onBeforeRequest' + ' : ' + (details.url || '') + ':',details);
		}*/
		///
		const entry = new Entry();
		//entry.request = JSON.parse(JSON.stringify(details));
		entry.request = details;
		this.entries.set(details.requestId,entry);
		
		//and... *independly*, tabEntries.
		if(!this.tabEntries.has(details.tabId)){
			this.tabEntries.set(details.tabId, new Map());
		}
		this.tabEntries.
			get(details.tabId).
			set(details.requestId, entry /*this.entries.get(details.requestId)*/); 

		this.onWebRequest('onBeforeRequest',details);
	}

	onSendHeaders(details){
		//might be that user did 'clear' while this request was still going on.
		if(!this.entries.has(details.requestId)){
			logger.log('no entry for ' + details.requestId + ':',details);
			return;
		}		
		this.entries.get(details.requestId)['request']['headers'] = details.requestHeaders;
		this.onWebRequest('onSendHeaders',details);
	}
	/*
	onHeadersReceived(details){
		this.onWebRequest('onHeadersReceived',details);	
	}*/

	onCompleted(details){
		//no such thing yet (or already) not sure why but this ... happens
		//maybe it's a matter of deleting entries (clear) while there are still on going ones.
		if(!this.entries.has(details.requestId)){
			logger.log('no entry for ' + details.requestId + ':',details);
			return;
		}			
		//this.entries[details.requestId]['response'] = details;

		//renaming 'responseHeaders' to simply 'headers' for consistency
		details['headers'] = details.responseHeaders;
		delete details['responseHeaders'];

		//adding:
		this.entries.get(details.requestId)['response'] = details;
		this.onWebRequest('onCompleted',details);
	}

	onErrorOccurred(details){
		//no such thing yet (or already), not sure why but this ... happens
		if(!this.entries.has(details.requestId)){
			logger.log('no entry for ' + details.requestId + ':',details);
			return;
		}	
		//we only have this, when error:
		/*
		this.entries.get(details.requestId)['response'] = {
			error: details.error,
			timeStamp : details.timeStamp,
		}*/
		this.entries.get(details.requestId)['response'] = details;
		this.onWebRequest('onErrorOccurred',details);
	}

	/**
	 * returns entries by search critieria
	 * @param {object} criteria
	 * 	if null, *all* entries are returned keyed by 'request_id'.
	 *  otherwise: 
	 *  criteria { 
	 *    tabId : if not null, only the entries for given tabId are returned as a Map(!)
	 *    requestId : if not null, only the entries for given requestId are return (no problem there is both above are defined)
	 *  }
	 * 
	 */
	query(criteria = {}){
		if(criteria == null || Object.keys(criteria).length === 0){
			return this.entries;
		}
		
		//first phase src entries:
		let srcEntries = null;//one object or map
		if(typeof criteria.tabId !== 'undefined'){
			//is tabId valid integer?
			console.assert(parseInt(criteria.tabId) == criteria.tabId);
			srcEntries = this.tabEntries.get(parseInt(criteria.tabId));
		};
		
		//even if both are defined, that is fine
		if(typeof criteria.requestId !== 'undefined'){
			srcEntries = this.entries.get(criteria.requestId);
			logger.log('reading by requestId: ' + criteria.requestId);
		};

		if(typeof srcEntries === 'undefined'){
			return {};
		}
		return srcEntries;

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
			logger.log('new subscriber, criteria: ' , message.criteria);
			this.subscribers.push({
				port : port,
				criteria: message.criteria, 
			});
		}
		if (message.command === "unsubscribe"){
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

		//'clear' button (or clear all)
		if (message.command === 'clearEntries'){

			//Is this clearing a specific tab only?
			if(message.criteria && message.criteria.tabId)	{
				let tabId = parseInt(message.criteria.tabId);
				//logger.log('clearing tab id: ' + tabId);
				console.assert(tabId == message.criteria.tabId);
				
				//first we'll get the entries from the given tab, grab their requestId and remove 
				//items this.entries by requestId
				const theTabEntries = this.tabEntries.get(tabId);
				if(theTabEntries){
					theTabEntries.forEach((entry,key) => {
						this.entries.delete(key);
					})
					this.tabEntries.delete(tabId);
				}
			}
			else{
				//removing absolutely everything
				//logger.log('clearing absolutely everything');
				this.tabEntries.clear();
				this.entries.clear();
			}
			//notifing subscribers.
			this.notifySubscribers(null,'entriesClearedNotification',{});
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
				clearedTabs.push(tabId); 		
			}
		})
		return clearedTabs;
	}

	/**
	 * In case we get too fat (too many requests recorded), here we're removing older entries.
	 * We are called here every few seconds.
	 */
	autoClear(){
		//logger.log('autoClear started');
		//this should be optional
		//if any tab has more than x items, remove the overhead and a few more:
		const limitPerTab = 1500;
		let clearedTabs = this.clearOversizedTabs(limitPerTab,limitPerTab * 0.1);
		if(clearedTabs.length > 0){
			//send notification to the concerned tabs:
			this.notifySubscribers(clearedTabs,'entriesAutoClearedNotification');
			this.addInternalLog('autoClear - cleared tabs',{tabs: clearedTabs});
		}
		//if for any reason the main tab-agnostic this.entries map also have a ridicuusly large number of items:
		//yeah, hard coded again. Should go to options somewhere, or maybe be based on the particular host
		//machine speed.
		const limitGlobal = 100000;
		if(this.entries.size > limitGlobal){
			const removeCount = (this.entries.size - limitGlobal) + (limitGlobal * 0.1);
			utils.deleteMapHead(this.entries, removeCount);
			//send notification to all the tabs:
			this.notifySubscribers(null,'entriesAutoClearedNotification');
			this.addInternalLog('autoClear - cleared general log (all tabs)',{removeCount: removeCount});
		}
		
	};

	/**
	 * 
	 * @param {string | object} message - a message or a whole object
	 * @param {object} data : optional additional data
	 */
	addInternalLog(message, data = {}){
		let log = {};
		if(typeof message === 'object'){
			log = message;
		}else{
			log = {
				message: message,
				data: data,
			};
		}
		this.internalLog.push(log);
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

