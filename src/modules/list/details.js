/**
 * dialog window (or just a div) showing the entry details
 */
class EntryDetails{
    constructor(container){
        this.container = container;
        this.template = `
        `; 
    }
    makeTitle(parent, title){
        let titleEl = document.createElement('h2');
        titleEl.textContent = title;
        parent.appendChild(titleEl);
    }

    makeRow(parent, name, val){
        const rowEl = document.createElement('div')
        rowEl.classList.add('row');

        const nameEl = document.createElement('span');
        nameEl.classList.add('name');
        nameEl.textContent = name + ':';

        const valEl = document.createElement('span');
        valEl.classList.add('val');
        valEl.textContent = val;

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
     * 
     * @param timestamp in miliseconds (not unix' seconds!)
     */
    formatTime(timestamp){
        var date = new Date(timestamp);
        var hours = date.getHours();
        // Minutes part from the timestamp
        var minutes = "0" + date.getMinutes();
        // Seconds part from the timestamp
        var seconds = "0" + date.getSeconds();
        
        // Will display time in 10:30:23 format
        return hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);        
    }

    setEntry(entry){
        //console.log(entry);

        utils.removeChildren(this.container);

        entry = JSON.parse(JSON.stringify(entry));
        

        this.makeTitle(this.container, 'General');
      
        this.makeRow(this.container,'Request URL', entry.request.url);
        this.makeRow(this.container,'Request Method', entry.request.method);
        this.makeRow(this.container,'Status Code', entry.response.statusCode);
        if(entry.response.error){
            this.makeRow(this.container,'Error', entry.response.error);
        }
        this.makeTitle(this.container, 'Response headers');
        if(entry.response.headers){
            this.headersSort(entry.response.headers);
            entry.response.headers.forEach(element => {
                this.makeRow(this.container, element.name, element.value);
            });
        }

        this.makeTitle(this.container, 'Request headers');
        if(entry.request.headers){
            this.headersSort(entry.request.headers);
            entry.request.headers.forEach(element => {
                this.makeRow(this.container, element.name, element.value);
            });
        }                        
        
        this.makeTitle(this.container, 'Other');
        this.makeRow(this.container,'Initiator', entry.request.initiator);
        this.makeRow(this.container,'From cache', entry.response.fromCache);
        //this.makeRow(this.container,'Timestamp', this.formatTime(entry.response.timeStamp));
        
        if(typeof app !== 'undefined' && app.isDev()){
            this.makeTitle(this.container, 'Debugging info (dev mode only)');
            const preEl = document.createElement('pre');
            this.makeRow(preEl,'Whole entry jsoned', JSON.stringify(entry, null, 4));
            this.container.appendChild(preEl);
        }
    }
}