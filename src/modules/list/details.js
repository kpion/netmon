/**
 * dialog window (or just a div) showing the entry details
 * We avoid using .innerHTML here, both mozilla and google don't like it.
 * It's is *not* modal dialog, hence no 'close' method etc. Here we're only responsible for the
 * details view and it can be used in other places as well.
 */
class EntryDetails{
    constructor(container){
        this.container = container;
        this.template = `
        `; 
    }

    /**
     * creates a new <a> element, doesn't add it anywhere
     * params: <a href = <href> title = <title> target = <target>>text</a>
     * target can be e.g. '_blank'
     */
    createLink (href, text = null, title = null, target = null){
        if(text === null){
            text = href;
        }
        let linkEl = document.createElement('a');
        linkEl.setAttribute('href',href);
        if(target){
            linkEl.setAttribute('target',target);
        }
        if(title){
            linkEl.setAttribute('title',title);
        }
        linkEl.textContent = text;
        return linkEl;
    }

    makeTitle(parent, title){
        let titleEl = document.createElement('h2');
        titleEl.textContent = title;
        parent.appendChild(titleEl);
    }

    /**
     * a new row like: <div><span>name</span><span>value</span></div>
     * @param {string | Node}  value - can be either a simple string or an htmlelement
     */
    makeRow(parent, name, val){
        const rowEl = document.createElement('div')
        rowEl.classList.add('row');

        const nameEl = document.createElement('span');
        nameEl.classList.add('name');
        nameEl.textContent = name + ':';

        const valEl = document.createElement('span');
        valEl.classList.add('val');
        if(val instanceof Node){
            valEl.appendChild(val);
        }else{
            valEl.textContent = val;
        }

        rowEl.appendChild(nameEl);
        rowEl.appendChild(valEl);

        parent.appendChild(rowEl);
    }

    //in place header array sort. Changes passed array
    headersSort(array){
        array.sort((a,b) => {
            var nameA = a.name.toUpperCase(); 
            var nameB = b.name.toUpperCase();
            if (nameA < nameB) {
              return -1;
            }
            if (nameA > nameB) {
              return 1;
            }
          
            // names must be equal
            return 0;        
        })
    }

    /**
     * Converts timestamp to hh:mm:ss
     * @param timestamp in miliseconds (not unix' seconds!)
     */
    formatTime(timestamp){
        var date = new Date(timestamp);
        var hours = "0" + date.getHours();
        // Minutes part from the timestamp
        var minutes = "0" + date.getMinutes();
        // Seconds part from the timestamp
        var seconds = "0" + date.getSeconds();
        
        // Will display time in 10:30:23 format
        return hours.substr(-2) + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);        
    }

    setEntry(entry){
        //console.log(entry);

        utils.removeChildren(this.container);

        entry = JSON.parse(JSON.stringify(entry));
        

        this.makeTitle(this.container, 'General');
        const urlLinkEl = this.createLink(entry.request.url,entry.request.url,null,'_blank');
        this.makeRow(this.container,'Request URL', urlLinkEl);
        this.makeRow(this.container,'Request Method', entry.request.method);
        this.makeRow(this.container,'Status Code', entry.response.statusCode);
        if(entry.response.error){
            this.makeRow(this.container,'Error', entry.response.error);
        }
        this.makeRow(this.container,'Started', this.formatTime(entry.request.timeStamp));
        this.makeRow(this.container,'Total time', 
            entry.extra.time ? utils.formatTimeSpan(entry.extra.time) : '?');


        this.makeTitle(this.container, 'Request headers');
        if(entry.request.headers){
            this.headersSort(entry.request.headers);
            entry.request.headers.forEach(element => {
                this.makeRow(this.container, element.name, element.value);
            });
        }                        
                

        this.makeTitle(this.container, 'Response headers');
        if(entry.response.headers){
            this.headersSort(entry.response.headers);
            entry.response.headers.forEach(element => {
                this.makeRow(this.container, element.name, element.value);
            });
        }

        this.makeTitle(this.container, 'Other');
        this.makeRow(this.container,'Initiator', entry.request.initiator);
        this.makeRow(this.container,'From cache', entry.response.fromCache);
        
        if(typeof app !== 'undefined' && app.isDev()){
            this.makeTitle(this.container, 'Debugging info (dev mode only)');
            const preEl = document.createElement('pre');
            this.makeRow(preEl,'Whole entry jsoned', JSON.stringify(entry, null, 4));
            this.container.appendChild(preEl);
        }
    }
}