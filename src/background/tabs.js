
/**
 * As *current* as possible state of all tabs opened in all browser windows.
 * 'title', 'url', and active tab.
 * 
 * Made for quick access for tab info, without quering the browser (with chrome.tabs.query or similar)
 * every single time we have a request.
 * 
 * We cache the tabs info in three ways: 
 * 1. webNavigation.onDOMContentLoaded - this calls update() method which queries the browser for the tab info
 * 2. just in case we missed some info using way #1 (e.g. because the extension was just installed now), 
 * 	the getOrQuery() method will also call the update() function (which queries the browser) but 
 * 	**only** when the tab is missing in our cache
 * 3. the webNavigation.onBeforeNavigate (which btw happens before onDOMContentLoaded) is there to 
 * 	actually **clear** this tab info, because the tab title might now be obsolote, but it updates the url (which
 * 	is fresh).
 */
class Tabs{

	constructor(){

		//all the info as it is when doing chrome.tabs.query({}...)
		//indexed under tab.id
		//we don't want new Map, because we don't care about the order and other features.
		this.tabs = {};
		this.activeTab = {};
		this.updateAll();
		
		//onBeforeNavigate starts very soon, just before opening the url. The url is known already, but 
		//tab's title is not. We still want to handle this for this exact reason - claring the tab's title
		//so the monitor will not display an obsolete one.

		//this is one of the 3 methods in this class to obtain tab info
		chrome.webNavigation.onBeforeNavigate.addListener((details) => {
			//console.log('on before:',details);
			if(details.frameId === 0){//main frame, not some sub iframes
				if(this.is(details.tabId)){
					//the title is now (probably) obsolote, it's better to simply clear it. So we won't display it.
					this.tabs[details.tabId].title = '';
					//this one on the other hand is quite up to date.
					this.tabs[details.tabId].url = details.url;
				}
			}
		});

		//we now know the tab's title. And maybe other things as well.
		chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
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

		/////////////////////////////////////////////////
		//currently active
		chrome.tabs.onActivated.addListener((details) => {
			//we don't have too much info in details, and this one will take care about 
			//this.activeTab and we get same info as in this.tabs
			this.updateAll();
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
				if(tab.active){
					this.activeTab = tab;
				}
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
		return this.tabs[tabId];
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

	getActiveTab(){
		return this.activeTab;
	}

	/**
	 * Tells if this is 'our' tab, i.e. belonging to the extension.
	 * Based on the tab's URL. Extension's base url should be found there on position 0.
	 * @param {object | int} tab - tabId or a tab object (e.g. one of the this.tabs items)
	 */
	isOur(tab){
		tab = typeof tab === 'object' ? tab : this.get(tab);
		if(!tab || !tab.url){
			return false;
		}
		return tab.url.indexOf(chrome.runtime.getURL('')) === 0;
	}
}
