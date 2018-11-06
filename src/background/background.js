'use strict';
const logger = new Logger('',app.isDev());


//
logger.log('netmon started');


class Monitor{
	constructor (){
		this.init();
	}

	//might be called multiple times (e.g. to reset):
	init(){
		//Map. all Entry objects by requestId, absolutely all entries, no dividing into tabs, with main key being
		this.entries = new Map();

		//Map of Maps - references to .entries objects above by tabId and then by requestId.
		this.tabEntries = new Map();

		//Object. These are objects with *Ports* by tabId, see onMessage. One tab can have only one subscriber
		this.tabSubscibers = {};
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
			
			port.onMessage.addListener(message => {
				this.onMessage(port, message);
			})

			port.onDisconnect.addListener(something => {
				//removing subscriber (added by this.onMessage):
				for(var n in this.tabSubscibers){
					if(this.tabSubscibers[n].port === port){
						logger.log('subscriber removed, tabId: ' + n);
						delete this.tabSubscibers[n];
						break;
					}
				}
			})

		});			
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

		//this one does not remove entries from this.entries, only a map of tabEntries to entries.
		//thanks to that, the very next initialQuery (or any other query) to this particular tab will give only the requests
		//following after this reset.
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
		const subscriber = this.tabSubscibers[details.tabId];
		if(typeof subscriber !== 'undefined'){
			const port = subscriber.port;
			try{
				port.postMessage({
					command: 'subscription', 
					eventName: eventName,
					details: details,
				});
			}catch(error){
				//logger.log('error with port.postMessage: ',error, ' subscribed removed');
				//most probably 'disconnected port' or similar, removing.
				delete this.tabSubscibers[details.tabId];
			}			
		}
	}

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
		
		if(!this.tabEntries.has(details.tabId)){
			this.tabEntries.set(details.tabId,new Map());
		}
		this.tabEntries.
			get(details.tabId).
			set(details.requestId, entry /*this.entries.get(details.requestId)*/); 

		this.onWebRequest('onBeforeRequest',details);
	}

	onSendHeaders(details){
		//this.entries[details.requestId]['request']['headers'] = details.requestHeaders;		
		this.entries.get(details.requestId)['request']['headers'] = details.requestHeaders;
		this.onWebRequest('onSendHeaders',details);
	}
	/*
	onHeadersReceived(details){
		this.onWebRequest('onHeadersReceived',details);	
	}*/

	onCompleted(details){
		//this.entries[details.requestId]['response'] = details;

		//renaming 'responseHeaders' to simply 'headers' for consistency
		details['headers'] = details.responseHeaders;
		delete details['responseHeaders'];

		//adding:
		this.entries.get(details.requestId)['response'] = details;
		this.onWebRequest('onCompleted',details);
	}

	onErrorOccurred(details){
		//no such thing yet, not sure why but this ... happens
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
			srcEntries = this.tabEntries.get(criteria.tabId);
		};
		//even if both are defined, that is fine
		if(typeof criteria.requestId !== 'undefined'){
			srcEntries = this.entries.get(criteria.requestId);
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
			logger.log('new subscriber, tabId: ' + message.tabId);
			this.tabSubscibers[message.tabId] = {
				port: port,
			};
		}
		if (message.command === "unsubscribe"){
			if(this.tabSubscibers[message.tabId]){
				delete this.tabSubscibers[message.tabId];
			}
		}

		if (message.command == "queryEntries"){
			let entries = this.query(message.criteria || {});
			port.postMessage({
				command: 'callback', 
				callbackData: typeof message.callbackData == 'undefined'? {} : message.callbackData,
				inResponseTo: message.command,

				result: Array.from(entries), 
				errorCode: 0
			});
		}				
	}
}

const monitor = new Monitor();
monitor.run();

//not related to the Monitor stuff. 
chrome.runtime.onMessage.addListener(
  function(message, sender, sendResponse) {
	//console.log on behalf of something else, like browser action popup (to make it easier on chrome)
	if(message.command == "logPlease"){
		logger.log('from ' + message.from + ':');
		logger.log(message.param);
	}
    if (message.command == "queryEntries"){
		let entries = monitor.query(message.criteria || {});
      	sendResponse({errorCode: 0, result: entries});
    }
});

