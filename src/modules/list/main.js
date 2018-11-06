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
        this.currentTab = null;
        this.port = null;
        this.mode = null;

        //Map of all Entry objects by requestId, for this tab. 
        //**Referenced** in e.g. table.js
        this.entries = new Map();

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

        //we want to know 'our' tab id regardless mode (popup or full)
        chrome.tabs.query({currentWindow: true, active: true},tab => {
            if(!tab[0]){
                console.error('tab[0] is undefined o.O')
                return;//impossible
            }
            this.currentTab = tab[0];
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
        if(this.mode === 'popup'){
            criteria.tabId = this.currentTab.id;
        }
        this.port.postMessage({
            command:'queryEntries',
            //criteria: {tabId : this.currentTab.id},
            criteria: criteria,
            callbackData: {'action' : 'initialQuery'},//we'll get this one when called back.
        });

        //subscribing for the next events (requests), which will probably come:
        this.port.postMessage({
            command:'subscribe',
            tabId : this.currentTab.id,
        }); 
        
        //interface
        if(this.mode === 'full'){
            l('#showFull').css('display','none');    
        }

        if(this.mode !== 'full'){
            l('#showFull').on('click',()=>{
                chrome.tabs.create({url:chrome.extension.getURL("modules/list/index.html?mode=full")}, function(tab) {
                });
            })        
        }
    }

    //message (callback) from our port (probably from background js in response to our 'command')
    onMessage(message){
        //callback in response to *our* initialQuery query
        if(message.callbackData && message.callbackData.action == 'initialQuery' ){
            console.log('initialQuery:', message.result);
            message.result.forEach(([k,v])=>{
                this.entries.set(k,v);
            });
            this.table.make();
        }

        //our 'subscription' callback from background js' monitor
        if(message.command === 'subscription'){
            this.onWebRequest(message.eventName,message.details);
        }
       
    }

    //requests going *live* while we're opened
    onWebRequest(eventName, details){
        //this.logBkg ({eventName:eventName, details});
        if(eventName === 'onBeforeRequest'){
            const entry = new Entry();
            entry.request = JSON.parse(JSON.stringify(details));
            this.entries.set(details.requestId, entry);
        }else if (eventName === 'onSendHeaders'){
            this.entries.get(details.requestId)['request']['headers'] = details.requestHeaders;	            
        }else if (eventName === 'onCompleted'){
            details['headers'] = details.responseHeaders;
            delete details['responseHeaders'];            

            this.entries.get(details.requestId)['response'] = details;
            //renaming 'responseHeaders' to simply 'headers' for consistency
            //tests:
            //this.table.remove(); this.table.make();//works ok, whole table recreated.
            this.table.addRow(this.entries.get(details.requestId));
        }                
    }
    //logging on behalf on background.js - easier to observe it than with 'inspect popup' on chrome
    //yeah, pretty akward.
    logBkg(param){
        chrome.runtime.sendMessage({command:'logPlease',from: `popup tabId: ${this.currentTab.id}`,'param': param});
    }
}

l(function (){
    const list = new List();
    list.initAndRun();


})
