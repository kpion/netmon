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
        this.table.setEntries(this.entries);

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
     * clearing data (but not filters)
     */ 
    clearData(){
        this.table.remove(true,true);
        this.entries.clear();
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
            this.table.make();
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
        }else if (eventName === 'entriesClearedNotification'){
            //something somewhere did a log clearing, we don't care here if it's us or not, we'll just reread.
            this.clearData();
            this.readAwaiting();
        }                
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
