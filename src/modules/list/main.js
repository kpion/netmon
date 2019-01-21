'use strict';

/*
yes, this whole script is being re-executed from scratch every time the browser action item is clicked.
same with the html containing it, and everything.
*/
const logger = new Logger('',app.isDev());
logger.log('list.js');

/**
 * *everything*, i.e. table with requests, buttons etc.
 */
class List{
    constructor(){
        //queryTab: 'all': all tabs (usually in full mode). OR <integer>: specific id
        this.queryTab = null;

        this.port = null;
        this.mode = null;

        //Map of all Entry objects by requestId, for this tab. 
        //**Referenced** in e.g. table.js
        this.entries = new Map();

        //these are the 'visible' ones, e.g. after filtering. 
        this.entriesVisible = new Map();

        //lightdom element
        this.ltable = null;

        //table.js object:
        this.table = null;

        //details.js object:
        this.details = null;

        //element (lightdom)
        this.lstatus = null;
    }

    initAndRun(){

        /**
         * mode: taken from the url (?mode=xyz), 'popup' means we're started from browser action icon, hence showing only current tab requests,
         * 'full' means we're in full mode (showing all the requests)
         */
        var url = new URL(window.location.href);
        this.mode = url.searchParams.get("mode");
        if(this.mode == null){
            console.error('mode is not defined');
            this.mode = 'popup';//default one.
        }

        //which tab should we filter here?

        //possible tabId in url (or 'all' or nothing)
        let urlTab = url.searchParams.get("tab");
        //we want to know 'our' tab id regardless mode (popup or full) or tab defined in url
        //so we put test scenarios here:
        chrome.tabs.query({currentWindow: true, active: true},tab => {
            if(!tab[0]){
                console.error('tab[0] is undefined o.O')
                return;//impossible
            }
            const curTab = tab[0];
            if(urlTab != null){
                this.queryTab = urlTab;
            }else{
                if(this.mode === 'popup'){
                    this.queryTab = curTab.id;
                }else{
                    this.queryTab = 'all';
                }
            }
            this.run();
        });
    }

    run(){
        this.lstatus = l('#status');
        this.ltable = l('#entries-table')
        //#entries-table - <table> declared in index.html
        this.table = new Table(this.ltable[0]);
        const columns = [
            //display, request|reponse, key, css class (optional)
            ['ID','request','requestId','slim'],
            //['URL','request','url'],
            ['Requested domain','special','host','url-domain'],
            ['Requested name','special','pathNameSmart','url-name'],
            ['Method','request','method','slim'],
            ['Status','response','statusCode', 'slim'],
            ['Type','request','type','type'],
            ['Time','special','time','slim'],
        ];
        //specific stuff if in 'global' mode.
        if(this.queryTab == 'all'){
            //inserting another column
            columns.splice(1, 0, 
                ['Tab (initiator)','special','tabTitle','tab-title'],
            );
        }
        this.table.setColumns(columns);

        this.table.make();
        //setting reference to our entries map
        //this.table.setEntries(this.entries);

        //communication        

        this.port = chrome.runtime.connect({name:'watcher'});

        this.port.onMessage.addListener(message => {
            this.onMessage(message);
        });

        //used for subscribing and maybe other things (e.g. clearing this tabs' log)
        let criteria = {};
        if(this.queryTab !== 'all'){
            criteria.tabId = this.queryTab;
        }

        //getting requests made up until now.
        // this.port.postMessage({
        //     command:'queryEntries',
        //     criteria: criteria,
        //     callbackData: {'action' : 'initialQuery'},//we'll get this one when called back.
        // });
        this.readAwaiting();

        //subscribing for the next events (requests), which will probably come:
        this.port.postMessage({
            command:'subscribe',
            criteria: criteria,
        }); 
        
        //interface

        //buttons for clearing, closing, opening new netmon tools.
        
        if(this.queryTab === 'all'){
            l('#showFull').css('display','none');    
            l('#clearTab').css('display','none'); 
        }

        //these are about 'full window' vs 'popup', not about reading a particular tab or not.
        if(this.mode === 'full'){
            l('#showFull').css('display','none');  
            l('#popOut').css('display','none');  
        }
        if(this.mode === 'popup'){
            l('#clearAll').css('display','none');  
        }

        l('#showFull').on('click',()=>{
            chrome.tabs.create({url:chrome.extension.getURL("modules/list/index.html?mode=full")}, function(tab) {
            });
        })        
    
        l('#popOut').on('click',()=>{
            window.open(chrome.extension.getURL(`modules/list/index.html?mode=full&tab=${this.queryTab}`));
        })          
        
        l('#clearTab, #clearAll').on('click',(ev)=>{
            let clearCriteria = ev.currentTarget.matches('#clearTab') ? criteria : {};
            //console.log('clear crits:',clearCriteria);
            this.port.postMessage({
                command:'clearEntries',
                criteria: clearCriteria,
            });            
        });

        //////////////////
        //details dialog or div

        //close button:    
        l('.modal .modal-btn-close, .modal .modal-btn-ok').on('click',(ev)=>{
            l(ev.target).closest('.modal').removeClass('modal-visible');
        })

        this.details = new EntryDetails(l('#modal-entry-details .content')[0]);
        const lTableBody =  l('#entries-table tbody');
        lTableBody.on('click',ev => {
            const lTarget = l(ev.target);
            //details popup
            if(lTarget.is('#entries-table tbody tr *')){
                const reqestId = lTarget.closest('tr').attr('data-requestid');
                const entry = this.entries.get(reqestId);
                if(!entry){
                    return;
                }
                l('#modal-entry-details').addClass('modal-visible');

                this.details.setEntry(entry);                 
            }
        })

        //filtering
        l('#filter #filter-text').on('input',(ev) => {
            this.updateTable();
            this.updateStatus();
        });
    }

    /**
     * getting requests made up until now. Used on initial start or on some ocassions, like notification
     * from background.js about e.g. clearing log.
     */
    readAwaiting(){
        
        let criteria = {};
        if(this.queryTab !== 'all'){
            criteria.tabId = this.queryTab;

        }

        //getting requests made up until now.
        this.port.postMessage({
            command:'queryEntries',
            criteria: criteria,
            callbackData: {'action' : 'initialQuery'},//we'll get this one when called back.
        });
    }

    /**
     * Clears data, both 'original' (here) and in the table object. 
     * Does not clear filters.
     */ 
    clearData(){
        this.entries.clear();
        this.table.remove(false,true);
    }

    //message (callback) from our port (probably from background js in response to our 'command')
    onMessage(message){
        //console.log('onMessage:',message);

        //callback in response to *our* initialQuery query
        if(message.callbackData && message.callbackData.action == 'initialQuery' ){
            //we need to convert an array to a map. This needs to be an array initially, because there are
            //some issues with chrome when sending a Map from background.js
            message.result.forEach(([k,v])=>{
                let entry = new Entry();
                Object.assign(entry,v);//this actually could be moved to a Entry constructor.
                this.entries.set(k,entry);
            });
            

            //initial build, this will make the header (columns)
            //then .updateTable will also add the rows. p.s. this.entries will *not* be stored 'for later' by `table`.
            this.updateTable();
            this.updateStatus();
        }

        //our 'subscription' callback from background js' monitor
        if(message.command === 'subscription'){
            this.onSubscription(message.eventName,message.details);
        }
       
    }

    //requests going *live* while we're opened
    //we'll add a request to this->entries *and* will notify this.table to add a row.
    //btw, this.table has a *reference* to this->entries, but here, when doing 'addRow' it doesn't
    //make any use of this fact.
    onSubscription(eventName, details){
        //this.logBkg ({eventName:eventName, details});
        logger.log('onSubscription:',Date.now(), eventName, details);
        if(eventName === 'onBeforeRequest'){
            const entry = new Entry();

            //In contrast to the other on..., here in 'details' a whole entry is sent. 
            //With request, empty reponse, some extras 
            //this actually could be moved to a Entry constructor.
            
            Object.assign(entry,JSON.parse(JSON.stringify(details)));
            this.entries.set(details.request.requestId, entry);
            logger.log('onBeforeRequest',Date.now(), entry);
            if(this.matches(entry, this.getFilters())){
                this.table.addRow(entry);
            }else{
                logger.log('...but wasn\'t matching');
            };            
        }else if (eventName === 'onSendHeaders'){
            const entry = this.entries.get(details.requestId);
            if(entry){
                entry['request']['headers'] = details.requestHeaders;	            
            }
        }else if (eventName === 'onCompleted' || eventName === 'onErrorOccurred'){
            const entry = this.entries.get(details.requestId);
            if(entry){
                entry.response = details;
                this.table.updateRow(entry);
                //regardless matching or not (because we might want to update 'y' in "x/y requests", i.e. total)
                this.updateStatus();
            }else{
                logger.log('warning, no entry for ' + details.requestId);
            }
        }else if (
            eventName === 'entriesClearedNotification' || 
            eventName === 'entriesAutoClearedNotification'
            ){
            //logger.log('cleared!: ', eventName);
            //user somewhere did a *manual* cleaning, we don't care here if it's us or not, we'll just reread.
            this.clearData();
            this.readAwaiting();
        }                
    }

    addTableRow(entry){
        const m = new Map();
    }

    /**
     * (Re)Updates *whole* table, based on our .entries AND filters.
     * Used on initial startup and when filters change.
     */
    updateTable(){
        //removing table body rows:
        this.table.remove(false,true);

        //we store it in entriesVisible for future reference (e.g. in this.updateStatus). 
        //If there is no filtering then this.entriesVisible will be an exact copy of this.entries
        this.entriesVisible = this.getFiltered(this.entries);
        //readding (or adding for the first time, doesn't matter)
        this.table.addRows(this.entriesVisible);
    }

    updateStatus(){
        let statusString = '';
        const entriesTotal = this.entries.size;
        const entriesVisible = this.entriesVisible.size;//@todo - change that when filtering implemented
        if(entriesTotal === entriesVisible){
            statusString = `${entriesTotal} requests`;
        }else{
            statusString = `${entriesVisible}/${entriesTotal} requests`;
        }
        //ms
        let totalTime = 0;
        this.entriesVisible.forEach(entry => {
            if(entry.extra.time){
                totalTime += entry.extra.time;
            }
        });
        totalTime = totalTime.toFixed(0);
        statusString += ` | ${totalTime} ms`;
        this.lstatus.text(statusString);
    }

    /**
     * Based on GUI prepares and object with filters, like 'text'. Also 'active' which tells if there is 
     * any filtering at all
     */
    getFilters(){
        let filters = {
            active: false,//one or more of the filters is active?
            text: '',//original one (although trimmed)
            textRegExp: null, //RegExp object (or null) -  prepared for actual regex test.
            //in future versions here we'll have  maybe mimetype etc.
        }

        filters.text = document.querySelector('#filter #filter-text').value;
        filters.text = filters.text.trim();

        
        if( filters.text != ''){
            filters.active = true;
            //is it wrapped in // ? Like '/blah.*/' - then user wants to treat it as a regex. 
            if(utils.hasRegexDelimeters(filters.text)){
                //we'll use only what's inside the / and / - just like it is.
                filters.textRegExp = new RegExp(filterText.substring(1, filters.text.length-1), "i");    
            }else{//otherwise we'll escape things like ? or * to do literal matching.
                filters.textRegExp = new RegExp(utils.escapeRegExp(filters.text), "i");
            }
        }

        return filters;
    };

    /**
     * Tells if an entry matches given filters
     * @param {*} entry - request object
     * @param {*} filters - filters object returned by this.getFilters
     */
    matches(entry, filters){
        if (!filters.active){
            return true;
        }

        //ok, there is at least one filter active. All tests must pass.
        let result = true;
        //text filter
        if(filters.textRegExp && !filters.textRegExp.test(entry.request.url)){
            result = false;
        }
        //and so on.... 
        return result;
    }

    /**
     * Filters given Map by using the filters in the interface
     * Returns exactly the same 'entries' map in case there are no filters active
     * Otherwise returns a modified copy. 
     */
    getFiltered(entries){
        const filters = this.getFilters();

        //no filtering at all, we return *now* with no further processing (for performance reasons, we just have
        //nothing to do here)
        if (!filters.active){
            return entries;
        }

        //ok, there is at least one filter active
        const resultEntries = new Map();

        var t0 = performance.now();
        entries.forEach((entry, requestId) => {
 
            if(this.matches(entry, filters)){
                resultEntries.set(requestId, entry);
            }
        });
        var t1 = performance.now();
        //console.log("Call to do regex filtering took " + (t1 - t0) + " milliseconds.");

        return resultEntries;
    }

   
    //logging on behalf on background.js - easier to observe it than with 'inspect popup' on chrome
    //yeah, pretty akward.
    logBkg(param){
        chrome.runtime.sendMessage({command:'logPlease',from: `popup tabId: ${this.queryTab}`,'param': param});
    }
}

//this one (list object) is here only because it's easier to debug stuff from the console in a browser, otherwise 
//it could as well be in the below anon. funk.
const list = new List();
l(function (){
    list.initAndRun();
})
