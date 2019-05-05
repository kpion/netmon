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
        this.lstats = null;

        //if 'true' we'll not show the loader, because apparently we're done.
        this.disableNextLoader = false;
    }

    initAndRun(){

        /**
         * mode: taken from the url (?mode=xyz), 'popup' means we're started from browser action icon, 
         * hence showing only current tab requests,
         * 'full' means we're in full mode (full window). We might show given specific tab OR global traffic.
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
        });;
    }

    run(){
        this.lstats  = l('#stats');
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
        //     callbackData: {'action' : 'readEntries'},//we'll get this one when called back.
        // });
        this.readEntries();
        this.readExtraInfo();
        //subscribing for the next events (requests), which will probably come:
        this.port.postMessage({
            command:'subscribe',
            criteria: criteria,
        }); 
        
        //interface

        //buttons for clearing, closing, opening new netmon tools.
        
        //global monitor vs specific tab monitor
        if(this.queryTab === 'all'){
            l('#showGlobal').css('display','none');    
            l('#clearTab').css('display','none'); 
        }else{//specific tab
            l('#clearAll').css('display','none'); 
        }

        //these are about 'full window' vs 'popup', not about reading a particular tab or not.
        if(this.mode === 'full'){
            l('#popOut').css('display','none');  
        }
        if(this.mode === 'popup'){
            l('#clearAll').css('display','none');  
        }

        l('#showGlobal').on('click',()=>{
            chrome.tabs.create({url:chrome.extension.getURL("modules/list/index.html?mode=full")}, function(tab) {
            });
            window.close();
        })        
    
        l('#popOut').on('click',()=>{
            window.open(chrome.extension.getURL(`modules/list/index.html?mode=full&tab=${this.queryTab}`));
            window.close();
        })          
        
        l('#clearTab, #clearAll').on('click',(ev)=>{
            let clearCriteria = ev.currentTarget.matches('#clearTab') ? criteria : {};
            //console.log('clear crits:',clearCriteria);
            this.port.postMessage({
                command:'clearEntries',
                criteria: clearCriteria,
            });            
        });

      

        //close button:    
        l('.modal .modal-btn-close, .modal .modal-btn-ok').on('click',(ev)=>{
            l(ev.target).closest('.modal').removeClass('modal-visible');
        })

        //filtering
        l('#filter-text').on('input',(ev) => {
            this.updateTable();
            this.updateStatus();
        });

        l('#filter-show-archived').on('change',(ev) => {
            //this one requires full reread. p.s. this one will take care about updating as well.
            this.readEntries();
        });
        
        //play/pause (state) button 
        l('#running').on('click',(ev)=>{
            const lbutton = l(ev.currentTarget);
            const lbuttonIcon = lbutton.find('.fa-icon');
            if(!lbutton.is('.pressed')){//in 'pause' mode, we enable playing
                lbutton.addClass('pressed');
                //lbutton.text('⏸️️');
                lbuttonIcon.removeClass('fa-play').addClass('fa-pause');
                //rereading the data which might have came in the meantime
                this.clearData();
                this.readEntries();                
            }else{//in 'playing' mode, we pause it.
                //lbutton.text('▶️');
                lbuttonIcon.removeClass('fa-pause').addClass('fa-play');
                lbutton.removeClass('pressed');
            }
            
        });        
        //block (state) button 
        l('#blocking').on('click',(ev)=>{
            const lbutton = l(ev.currentTarget);
            if(!lbutton.is('.pressed')){//in non blocking mode (default), we'll start blocking
                lbutton.addClass('pressed').addClass('pressed-highlight');
                this.port.postMessage({
                    command:'block',
                    criteria: criteria,
                });                  
            }else{//in blocking mode, so we'll unblock it
                lbutton.removeClass('pressed').removeClass('pressed-highlight');
                this.port.postMessage({
                    command:'unblock',
                    criteria: criteria,
                });                 
            }            
        });
        //tab info (e.g. color)
        const lTabInfo = l('#tabinfo');
        let tabInfoText = '';
        let color = '';
        if(this.queryTab === 'all'){
            tabInfoText = 'Global scope';
            color = 'rgb(0,0,0)';
        }else{//we are tab specific
            //tabInfoText = 'Tab: ' + this.queryTab;
            tabInfoText = 'Tab scope';
            color = utils.distinctColorFromNumber(parseInt(this.queryTab));
        }
        lTabInfo.text(tabInfoText);
        lTabInfo.css ({
            'border-left':`8px solid ${color}`,
            'padding-left':'3px',
        });
        if(app.isDev()){
            lTabInfo.attr('title',`[tabId: ${this.queryTab}]`);
        }        

        //////////////////
        //details dialog or div        

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

    }

    /**
     * getting all requests. Used on initial start or on some ocassions, like notification
     * from background.js about e.g. clearing log.
     */
    readEntries(){
        
        let criteria = {};
        if(this.queryTab !== 'all'){
            criteria.tabId = this.queryTab;

        }
        if(l('#filter-show-archived')[0].checked){
            //this will make background.js use the 'entries' rather than tabEntries, but filtered
            //by tabId
            criteria.useGlobal = true;
        }
        //getting requests made up until now.
        simplePerformance.mark('sending queryEntries msg');
        this.port.postMessage({
            command:'queryEntries',
            criteria: criteria,
            callbackData: {'action' : 'readEntries'},//we'll get this one when called back (in this.onMessage)
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

    //stats, like internal one (this.stats) but also related to specific tab 
    //(e.g. number of auto removed entries). This will eventually make run the this.updateExtraInfo()
    readExtraInfo(){
        let criteria = {};
        if(this.queryTab !== 'all'){
            criteria.tabId = this.queryTab;

        }
        this.port.postMessage({
            command:'getExtra',
            criteria: criteria,
            //callbackData: {'action' : 'onReadExtraInfo'},//we'll get this one when called back.
        });        
    }

    //inResponseTo === 'getStats') for example number of auto-removed entries.
    updateExtraInfo(extras){
        this.extraInfo = extras;
        //are we actually blocking something? Just to make the icon look right
        if(extras.tabExtra.blocking){
            l('#blocking').addClass('pressed').addClass('pressed-highlight');
        }
        //to be continued.
        //logger.log(extras);
    }

    //message (callback) from our port (probably from background js in response to our 'command')
    onMessage(message){
        //console.log('onMessage:',message);

        //callback in response to *our* readEntries query
        if(message.callbackData && message.callbackData.action === 'readEntries' ){
            
            simplePerformance.mark('received entries');
            this.entries.clear();
            this.entriesVisible.clear();

            //we need to convert an array to a map. This needs to be an array initially, because there are
            //some issues with chrome when sending a Map from background.js
            //this [k,v] means take first value of subarray to 'k' and the other to 'v', and btw, 'k' is a 
            //request id and v is the well, whole entry.
            message.result.forEach(([k,v])=>{
                //if it's our own tab, i.e. our 'global view' tab - like 
                //"chrome-extension://gkgkbnhnimkgahhagocmeimjbgjneidp/modules/list/index.html?mode=full"
                //we ignore it. It's just easier to do it here than in background.js. And, btw, FX doesn't
                //send this requests at all.
                if(v.extra.tab && v.extra.tab.url && v.extra.tab.url.indexOf('chrome-extension://') === 0){
                    return;
                }
                let entry = new Entry();
                Object.assign(entry,v);//this actually could be moved to an Entry constructor.
                this.entries.set(k,entry);
            });
            
            simplePerformance.mark('built entries');
            //>500 entries will take quite a few ms, so we'll show our 'loader'
            if(this.entries.size > 500){
                this.updateLoader(true,`loading ${this.entries.size} entries...`);
            }
            //timeout is there to allow a browser displaying a (possible) loader info. 
            setTimeout(() => {
                this.updateTable();
                this.updateStatus();
                simplePerformance.mark('updated table');
                //logger.log(simplePerformance.getReport());
                //do not show delayed loader 
                //this.disableNextLoader=true;
                this.updateLoader(false);        
            }, 50);
            
            
            
            
            simplePerformance.clearMarks();

        }
        if(message.command === 'callback' && message.inResponseTo === 'getExtra'){
            this.updateExtraInfo(message.result);
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
        
        //logger.log('onSubscription:',Date.now(), eventName, details);
        if(eventName === 'onBeforeRequest'){
            const entry = new Entry();

            //In contrast to the other on..., here in 'details' a whole entry is sent. 
            //With request, empty reponse, some extras 
            //this actually could be moved to a Entry constructor.
            
            Object.assign(entry,JSON.parse(JSON.stringify(details)));
            this.entries.set(details.request.requestId, entry);
            
            if(this.isPlaying() && this.matches(entry, this.getFilters())){
                this.table.addRow(entry);
            }
        }else if (eventName === 'onSendHeaders'){
            const entry = this.entries.get(details.request.requestId);
            if(entry){
                //entry['request']['headers'] = details.requestHeaders;	            
                Object.assign(entry,JSON.parse(JSON.stringify(details)));
            }
        }else if (eventName === 'onCompleted' || eventName === 'onErrorOccurred'){
            const entry = this.entries.get(details.response.requestId);
            if(entry){
                //entry.response = details;
                Object.assign(entry,JSON.parse(JSON.stringify(details)));
                if(this.isPlaying()){
                    this.table.updateRow(entry);
                    //regardless matching or not (because we might want to update 'y' in "x/y requests", i.e. total)
                    this.updateStatus();
                }
            }else{
                logger.log('warning, no entry in list view for ' + details.request.requestId);
            }
        }else if (
            eventName === 'entriesClearedNotification' || 
            eventName === 'entriesAutoClearedNotification'
           ){
            //logger.log('cleared!: ', eventName);
            //user somewhere did a *manual* cleaning, we don't care here if it's us or not, we'll just reread.
            if(this.isPlaying()){
                this.clearData();
                this.readEntries();
            }
        }                
    }

    /**
     * (Re)Updates *whole* table, based on our .entries AND filters.
     * Used on initial startup and when filters change. 
     * However, when the 'archived' filter changes, we actually resend the whole 
     * 'query' command to the background.
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
        totalTime = utils.formatTimeSpan(totalTime,2);
        statusString += ` | ${totalTime}`;
        this.lstats.text(statusString);
    }

    /*
    * show / hide loader (spinner, or just a word "loading....")
    * @param {bool} show  
    * */
    updateLoader(show, text = null){
        if(show && this.disableNextLoader){
            this.disableNextLoader = false;
            return;
        }
        const lloader = l('#loader');
        lloader.css({'display':show?'block':'none'});
        lloader.text(text?text:'');
    }

    /**
     * true if the 'play' (running) button is pressed.
     */
    isPlaying(){
        return l('#running').is('.pressed');
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

        filters.text = document.querySelector('#filter-text').value;
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

function getMonitor(){
    return monitor;
}