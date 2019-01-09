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
        
        this.table = null;
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

        //html table 

        //#entriesTable - <table> declared in index.html
        this.table = new Table(document.querySelector('#entriesTable'));

        this.table.setColumns([
            //display, request|reponse, key, css class (optional)
            ['ID','request','requestId','slim'],
            //['URL','request','url'],
            ['Domain','special','host'],
            ['Name','special','pathNameSmart','path-name-smart'],
            ['Method','request','method','slim'],
            ['Status','response','statusCode', 'slim'],
            ['Type','request','type','type'],
            ['𝄙','special','showDetails', 'show-details']
        ]);
        //setting reference to our entries map
        //this.table.setEntries(this.entries);

        //communication        

        this.port = chrome.runtime.connect({name:'watcher'});

        this.port.onMessage.addListener(message => {
            this.onMessage(message);
        });

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
        if(this.mode === 'full'){
            l('#showFull').css('display','none');  
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
            console.log('clear crits:',clearCriteria);
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
        const lTableBody =  l('#entriesTable tbody');
        lTableBody.on('click',ev => {
            const lTarget = l(ev.target);
            //details popup
            if(lTarget.is('#entriesTable tbody tr *')){
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
        this.table.remove(true,true);
    }

    //message (callback) from our port (probably from background js in response to our 'command')
    onMessage(message){
        //console.log('onMessage:',message);

        //callback in response to *our* initialQuery query
        if(message.callbackData && message.callbackData.action == 'initialQuery' ){
            //we need to convert an array to a map
            message.result.forEach(([k,v])=>{
                this.entries.set(k,v);
            });
            //initial build, this will make the header (columns)
            //then .updateTable will also add the rows. p.s. this.entries will *not* be stored 'for later' by `table`.
            this.table.make();
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
        //console.log('onSubscription:',eventName,eventName, details);
        if(eventName === 'onBeforeRequest'){
            const entry = new Entry();
            entry.request = JSON.parse(JSON.stringify(details));
            this.entries.set(details.requestId, entry);
        }else if (eventName === 'onSendHeaders'){
            this.entries.get(details.requestId)['request']['headers'] = details.requestHeaders;	            
        }else if (eventName === 'onCompleted'){
            this.entries.get(details.requestId)['response'] = details;
            //renaming 'responseHeaders' to simply 'headers' for consistency
            //tests:
            //this.table.remove(); this.table.make();//works ok, whole table recreated.
            this.table.addRow(this.entries.get(details.requestId));
            this.updateStatus();
        }else if (eventName === 'entriesClearedNotification'){
            //something somewhere did a log clearing, we don't care here if it's us or not, we'll just reread.
            this.clearData();
            this.readAwaiting();
        }                
    }

    /**
     * (Re)Updates *whole* table, based on our .entries AND filters.
     * Used on initial startup and when filters change.
     */
    updateTable(){
        //removing table body rows:
        this.table.remove(false,true);
        //readding (or adding for the first time, doesn't matter)
        let filtered = this.getFiltered(this.entries);
        this.table.addRows(filtered);
    }

    updateStatus(){
        let statusString = '';
        const entriesTotal = this.entries.size;
        const entriesVisible = this.entries.size;//@todo - change that when filtering implemented
        if(entriesTotal === entriesVisible){
            statusString = `${entriesTotal} requests`;
        }else{
            statusString = `${entriesVisible}/${entriesTotal} requests`;
        }
        this.lstatus.text(statusString);
    }

    /**
     * Filters given Map by using the filters in the interface
     * Returns exactly the same 'entries' map in case there are no filters active
     * Otherwise returns a modified copy. 
     */
    getFiltered(entries){
        //one or more of the filters is active?
        //we first test if there are any filters at all, to quit as quick as possible if there are none.
        let filtersActive = false;


        let filterText = document.querySelector('#filter #filter-text').value;
        filterText = filterText.trim();

        if(filterText != ''){
            filtersActive = true;
        }

        //more tests.
        if (!filtersActive){
            return entries;
        }
        //ok, there is at least one filter active
        const resultEntries = new Map();
        let filterTextRegex = null;
        if( filterText != ''){
            //is it wrapped in // ? Like '/blah.*/' - then user wants to treat it as a regex. 
            if(utils.hasRegexDelimeters(filterText)){
                //we'll use only what's inside the / and / - just like it is.
                filterTextRegex = new RegExp(filterText.substring(1, filterText.length-1), "i");    
            }else{//otherwise we'll escape things like ? or * to do literal matching.
                filterTextRegex = new RegExp(utils.escapeRegExp(filterText), "i");
            }
        }
        var t0 = performance.now();
        this.entries.forEach((entry, requestId) => {
            let add = true;
            if(filterTextRegex && !filterTextRegex.test(entry.request.url)){
                add = false;
            }
            if(add){
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

l(function (){
    const list = new List();
    list.initAndRun();
})
