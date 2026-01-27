import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CASE_OBJECT from '@salesforce/schema/Case';
import CASE_ACCOUNT_ID from '@salesforce/schema/Case.AccountId';
import CONTACT_ACCOUNT_ID from '@salesforce/schema/Contact.AccountId';
import { EnclosingTabId, openTab, onTabFocused } from 'lightning/platformWorkspaceApi';
import getDashboardData from '@salesforce/apex/MiniDashboardController.getDashboardData';
import getCaseList from '@salesforce/apex/MiniDashboardController.getCaseList';

const FIELDS_MAP = {
    Contact: [CONTACT_ACCOUNT_ID, 'Contact.Account.AVB_ICAO_Account__c'],
    Case: [CASE_ACCOUNT_ID, 'Case.AVB_ICAO_Account__c'],
    Account: ['Account.Id', 'Account.AVB_ICAO_Account__c']
};

const DEFAULT_COLUMNS = 'Subject, Priority, CreatedDate';
const DOT_SEP = '__DOT__';

const SEARCH_SHORTCUTS = {
    'icao account': 'Account.AVB_ICAO_Account__c',
    'icao': 'Account.AVB_ICAO_Account__c',
    'account': 'Account.Name',
    'case number': 'CaseNumber',
    'case #': 'CaseNumber'
};

export default class MiniDashboard extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    @api newThreshold = 5;
    @api openThreshold = 10;
    @api waitingThreshold = 5;
    @api holdThreshold = 5;
    
    @api columnFields = DEFAULT_COLUMNS;
    @api extraExportFields = '';
    @api defaultSortField = 'CreatedDate';
    @api defaultSortDirection = 'desc';
    @api pollingFrequency = 60;

    @api thresholdColor = '#ff0000';
    @api normalColor = '#000000';

    @track totalItems = this.initItems();
    @track myItems = this.initItems();
    @track accountItems = this.initItems();

    @track isModalOpen = false;
    @track isExportModalOpen = false;
    @track modalTitle = '';
    @track modalData = [];
    @track columns = [];
    @track selectableFields = [];
    
    @track sortedBy = 'CreatedDate';
        @track sortedDirection = 'desc';
        @track searchTerm = '';
        @track priorityFilter = [];
        @track hasJiraFilter = false;
        @track statusFilter = [];
        
        isLoadingModal = false;
        isLoadingMore = false;
        isSearching = false;
        isMoreDataAvailable = true;
        offset = 0;
        limit = 50;
    
        @wire(EnclosingTabId) enclosingTabId;
        @wire(getObjectInfo, { objectApiName: CASE_OBJECT }) caseInfo;
    
        accountId;
        icaoValue;
        pollingInterval;
        currentDashboardId;
        currentAccountId;
        currentOnlyMine = false;
        isFirstModalLoad = false;
    
        // Advanced search properties
        searchTimeout;
        advancedField = '';
        advancedValue = '';
    
            initItems() {
                return [
                    { id: 'New', fullLabel: 'New', shortLabel: 'N', count: 0, tooltip: '', barColor: '#81C784', cssClass: 'count-wrapper' },
                    { id: 'Open', fullLabel: 'Open', shortLabel: 'O', count: 0, tooltip: '', barColor: '#E57373', cssClass: 'count-wrapper' },
                    { id: 'Waiting for Customer', fullLabel: 'Waiting', shortLabel: 'W', count: 0, tooltip: '', barColor: '#64B5F6', cssClass: 'count-wrapper' },
                    { id: 'On Hold', fullLabel: 'Hold', shortLabel: 'H', count: 0, tooltip: '', barColor: '#90A4AE', cssClass: 'count-wrapper' },
                    { id: 'ALL', fullLabel: 'All', shortLabel: 'A', count: 0, tooltip: '', barColor: '#546E7A', cssClass: 'count-wrapper' }
                ];
            }    
        @wire(getRecord, { recordId: '$recordId', fields: '$currentFields' })
        wiredRecord({ error, data }) {
            if (data) {
                if (this.objectApiName === 'Account') { this.accountId = this.recordId; this.icaoValue = getFieldValue(data, 'Account.AVB_ICAO_Account__c'); } 
                else if (this.objectApiName === 'Contact') { this.accountId = getFieldValue(data, CONTACT_ACCOUNT_ID); this.icaoValue = getFieldValue(data, 'Contact.Account.AVB_ICAO_Account__c'); } 
                else if (this.objectApiName === 'Case') { this.accountId = getFieldValue(data, CASE_ACCOUNT_ID); this.icaoValue = getFieldValue(data, 'Case.AVB_ICAO_Account__c'); }
                this.fetchData();
            }
        }
    
        get currentFields() { return FIELDS_MAP[this.objectApiName] || []; }
        get showAccountRow() { return !!this.accountId; }
        get accountRowLabel() { return this.icaoValue ? this.icaoValue : 'Account'; }
        get hasNoModalResults() { return !this.isLoadingModal && this.modalData.length === 0; }
        get priorityFilterUrgent() { return this.priorityFilter.includes('Urgent') ? 'brand' : 'neutral'; }
        get priorityFilterHigh() { return this.priorityFilter.includes('High') ? 'brand' : 'neutral'; }
        get priorityFilterNormal() { return this.priorityFilter.includes('Normal') ? 'brand' : 'neutral'; }
        get priorityFilterLow() { return this.priorityFilter.includes('Low') ? 'brand' : 'neutral'; }
        get hasJiraBtnVariant() { return this.hasJiraFilter ? 'brand' : 'neutral'; }
        get showStatusFilter() { return this.currentDashboardId === 'ALL'; }
    
        get statusNewVariant() { return this.statusFilter.includes('New') ? 'brand' : 'neutral'; }
        get statusOpenVariant() { return (this.statusFilter.includes('Open') || this.statusFilter.includes('Working')) ? 'brand' : 'neutral'; }
        get statusWaitingVariant() { return this.statusFilter.includes('Waiting for Customer') ? 'brand' : 'neutral'; }
        get statusHoldVariant() { return this.statusFilter.includes('On Hold') ? 'brand' : 'neutral'; }
        get statusSolvedVariant() { return this.statusFilter.includes('Solved') ? 'brand' : 'neutral'; }
    
        connectedCallback() {
            this.startPolling();
            if (onTabFocused) { 
                onTabFocused((event) => { 
                    const currentTabId = this.enclosingTabId?.data;
                    if (!currentTabId || event.tabId === currentTabId) { 
                        this.fetchData(); 
                        this.startPolling(); 
                    } else { 
                        this.stopPolling(); 
                    } 
                }); 
            }
        }
    
        startPolling() { this.stopPolling(); this.pollingInterval = setInterval(() => { this.fetchData(); }, (this.pollingFrequency || 60) * 1000); }
        stopPolling() { if (this.pollingInterval) clearInterval(this.pollingInterval); }
    
        fetchData() {
            getDashboardData({ accountId: this.accountId })
                .then(result => {
                    this.totalItems = this.processItems(this.totalItems, result.totals);
                    this.myItems = this.processItems(this.myItems, result.myTickets);
                    if (result.accountSpecific) this.accountItems = this.processItems(this.accountItems, result.accountSpecific);
                })
                .catch(error => console.error(error));
        }
    
        processItems(items, data) {
            return items.map(item => {
                const summary = data[item.id] || { count: 0, priorityTooltip: '', priorityMap: {} };
                let threshold = 0;
                if (item.id === 'New') threshold = this.newThreshold;
                else if (item.id === 'Open') threshold = this.openThreshold;
                else if (item.id === 'Waiting for Customer') threshold = this.waitingThreshold;
                else if (item.id === 'On Hold') threshold = this.holdThreshold;
                const isOverThreshold = summary.count > threshold;
                const color = isOverThreshold ? this.thresholdColor : this.normalColor;
                let bgColor = 'transparent';
                if (summary.count > 0) {
                    if (summary.priorityMap['Urgent'] > 0) bgColor = 'rgba(229, 115, 115, 0.15)'; 
                    else if (summary.priorityMap['High'] > 0) bgColor = 'rgba(255, 183, 77, 0.2)';  
                    else bgColor = 'rgba(129, 199, 132, 0.15)'; 
                }
                return { ...item, count: summary.count, tooltip: summary.priorityTooltip, barStyle: `background-color: ${item.barColor}`, itemStyle: `color: ${color}`, heatmapStyle: `background-color: ${bgColor}` };
            });
        }
    
        handleItemClick(event) {
            this.currentDashboardId = event.currentTarget.dataset.id;
            this.currentAccountId = event.currentTarget.dataset.scope === 'account' ? this.accountId : null;
            this.currentOnlyMine = event.currentTarget.dataset.scope === 'my';
            
            // Start with no filters selected (as per user request)
            this.statusFilter = [];
            this.priorityFilter = [];
    
            this.modalData = []; this.offset = 0; this.isModalOpen = true; this.isFirstModalLoad = true;
            this.buildColumns(); this.loadModalData();
        }
    
        buildColumns() {
            let fieldList = this.columnFields.split(',').map(f => f.trim());
            const cols = [];
            const isCaseNumberSorted = this.sortedBy === 'CaseNumber';
            
            // 1. Case Number
            cols.push({ 
                label: 'Case Number', fieldName: 'CaseNumber', type: 'button', style: 'width: 100px; min-width: 100px; max-width: 100px;', 
                isSortable: true, showSortIcon: isCaseNumberSorted, headerClass: isCaseNumberSorted ? 'is-sorted' : 'is-sortable'
            });
    
            // 2. Status (Automatic for 'ALL')
            if (this.currentDashboardId === 'ALL') {
                const isStatusSorted = this.sortedBy === 'Status';
                cols.push({
                    label: 'Status', fieldName: 'Status', type: 'text', isSortable: true,
                    style: 'width: 150px; min-width: 150px; max-width: 150px;',
                    showSortIcon: isStatusSorted, headerClass: isStatusSorted ? 'is-sorted' : 'is-sortable'
                });
                // Ensure Status is not duplicated if it was already in fieldList
                fieldList = fieldList.filter(f => f.split(':')[0].trim().toLowerCase() !== 'status');
            }
    
            // 3. Other fields
            fieldList.forEach(f => {
                if (f.toLowerCase() === 'casenumber') return;
                const parts = f.split(':');
                const rawField = parts[0].trim();
                const width = parts.length > 1 ? parts[1].trim() : null;
    
                let fieldName = rawField;
                let label = rawField;
                let type = 'text';
                let isJira = false;
    
                if (rawField.toLowerCase() === 'jira') {
                    fieldName = 'Jira';
                    label = 'Jira Tickets';
                    isJira = true;
                } else if (rawField.includes('.')) {
                    fieldName = rawField.replaceAll('.', DOT_SEP);
                    label = rawField.split('.')[0] + ' ' + rawField.split('.')[1];
                } else if (this.caseInfo?.data?.fields[rawField]) {
                    label = this.caseInfo.data.fields[rawField].label;
                    if (rawField.toLowerCase().includes('date')) type = 'date';
                }
    
                const isSorted = fieldName === this.sortedBy;
                let headerClass = isSorted ? 'is-sorted' : (isJira ? '' : 'is-sortable');
    
                const style = width ? `width: ${width}px; min-width: ${width}px;` : '';
                cols.push({
                    label: label, 
                    fieldName: fieldName, 
                    type: type,
                    style: style,
                    isJira: isJira,
                    isSortable: !isJira,
                    headerClass: headerClass, 
                    showSortIcon: isSorted 
                });
            });
            this.columns = cols;
        }
    
    loadModalData() {
        const cleanFields = this.columnFields.split(',').map(f => f.trim().split(':')[0].trim());
        
        // Ensure Status field is retrieved for ALL view (case-insensitive check)
        const hasStatus = cleanFields.some(f => f.toLowerCase() === 'status');
        if (this.currentDashboardId === 'ALL' && !hasStatus) {
            cleanFields.push('Status');
        }
    
            if (this.offset === 0) {
                if (this.isFirstModalLoad) { this.isLoadingModal = true; this.isFirstModalLoad = false; } 
                else { this.isSearching = true; }
            } else {
                this.isLoadingMore = true;
            }
    
            getCaseList({
                dashboardId: this.currentDashboardId, accountId: this.currentAccountId, fields: cleanFields,
                sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection,
                searchTerm: this.searchTerm, offset: this.offset, onlyMine: this.currentOnlyMine,
                priorityFilter: this.priorityFilter, limitCount: this.limit,
                advancedField: this.advancedField, advancedValue: this.advancedValue,
                hasJira: this.hasJiraFilter, statusFilter: this.statusFilter
            })
            .then(data => {
                const flattened = this.flattenData(data).map(c => {
                    let rowClass = 'table-row';
                    if (c.Priority === 'Urgent') rowClass += ' priority-urgent';
                    else if (c.Priority === 'High') rowClass += ' priority-high';
                    else if (c.Priority === 'Normal') rowClass += ' priority-normal';
                    else if (c.Priority === 'Low') rowClass += ' priority-low';
    
                    const cells = this.columns.map(col => {
                        const recordValue = c[col.fieldName];
                        let displayValue = recordValue;
                        const isJira = !!col.isJira;
                        if (isJira) {
                            const jiraData = c['Jira_Tickets__r'];
                            const tickets = Array.isArray(jiraData) ? jiraData : (jiraData ? jiraData.records : null);
                            displayValue = tickets ? tickets.map(j => j.Name).join(', ') : '';
                        } else if (displayValue && col.fieldName.toLowerCase().includes('date')) {
                            displayValue = this.formatDate(displayValue);
                        }
                        return { key: col.fieldName, value: displayValue, isUrl: col.type === 'button', isJira: isJira };
                    });
                    return { ...c, rowClass: rowClass, cells: cells };
                });
                this.modalData = this.offset === 0 ? flattened : [...this.modalData, ...flattened];
                this.isMoreDataAvailable = data.length === this.limit;
            })
            .catch(error => this.handleError('Error loading cases', error))
            .finally(() => { this.isLoadingModal = false; this.isLoadingMore = false; this.isSearching = false; });
        }
    
        flattenData(data) {
            return data.map(record => {
                let flat = { ...record };
                Object.keys(record).forEach(key => {
                    const val = record[key];
                    if (val && typeof val === 'object' && !Array.isArray(val)) { Object.keys(val).forEach(k => { flat[`${key}${DOT_SEP}${k}`] = val[k]; }); }
                });
                return flat;
            });
        }
    
        handleSort(event) {
            const field = event.currentTarget.dataset.id;
            const col = this.columns.find(c => c.fieldName === field);
            if (col && col.isSortable === false) return;
            if (this.sortedBy === field) this.sortedDirection = this.sortedDirection === 'asc' ? 'desc' : 'asc';
            else { this.sortedBy = field; this.sortedDirection = 'asc'; }
            this.offset = 0; this.buildColumns(); this.loadModalData();
        }
    
        handleSearch(event) {
            const val = event.target.value;
            if (this.searchTimeout) clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.offset = 0; this.advancedField = ''; this.advancedValue = ''; this.searchTerm = '';
                if (val.includes(':')) {
                    const firstColon = val.indexOf(':');
                    const key = val.substring(0, firstColon).trim().toLowerCase();
                    let value = val.substring(firstColon + 1).trim();
                    if (value.startsWith('"') && value.endsWith('"')) value = value.substring(1, value.length - 1);
                    let fieldApiName = SEARCH_SHORTCUTS[key];
                    if (!fieldApiName) {
                        const col = this.columns.find(c => c.label.toLowerCase() === key || c.fieldName.toLowerCase() === key.replaceAll(' ', '.') || c.fieldName.toLowerCase() === key.replaceAll(' ', DOT_SEP));
                        if (col) fieldApiName = col.fieldName.replaceAll(DOT_SEP, '.');
                    }
                    if (fieldApiName) { this.advancedField = fieldApiName; this.advancedValue = value; } else { this.searchTerm = val; }
                } else {
                    this.searchTerm = val;
                }
                this.loadModalData();
            }, 300);
        }
    
        handlePriorityQuickFilter(event) { 
            const val = event.target.value;
            let newFilter = [...this.priorityFilter];
            if (newFilter.includes(val)) {
                newFilter = newFilter.filter(p => p !== val);
            } else {
                newFilter.push(val);
            }
            this.priorityFilter = newFilter;
            this.offset = 0; 
            this.loadModalData(); 
        }
        
        handleHasJiraToggle() { this.hasJiraFilter = !this.hasJiraFilter; this.offset = 0; this.loadModalData(); }
        
        handleStatusToggle(event) {
            const status = event.target.value;
            const statusList = status === 'Open' ? ['Open', 'Working'] : 
                              status === 'Waiting' ? ['Waiting for Customer'] :
                              status === 'On-Hold' ? ['On Hold'] : [status];
            
            let newFilter = [...this.statusFilter];
            const hasAll = statusList.every(s => newFilter.includes(s));
    
            if (hasAll) {
                newFilter = newFilter.filter(s => !statusList.includes(s));
            } else {
                statusList.forEach(s => { if (!newFilter.includes(s)) newFilter.push(s); });
            }
    
            this.statusFilter = newFilter;
            this.offset = 0;
            this.loadModalData();
        }
    
        handleTableScroll(event) {
            const target = event.target;
            const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
            if (scrollBottom < 50 && this.isMoreDataAvailable && !this.isLoadingModal && !this.isLoadingMore && !this.isSearching) {
                this.offset += this.limit;
                this.loadModalData();
            }
        }
    
        async viewCase(event) {
            const id = event.currentTarget.dataset.id;
            try { await openTab({ recordId: id, focus: true }); } catch (e) { this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: id, actionName: 'view' } }); }
        }
    
        handleStopPropagation(event) { event.stopPropagation(); }
        closeModal() { this.isModalOpen = false; }
        
        openExportConfig() { 
            const cols = this.columnFields.split(',').map(f => f.trim().split(':')[0].trim());
            const extras = this.extraExportFields ? this.extraExportFields.split(',') : [];
            const allFields = [...this.columnFields.split(','), ...extras].map(f => f.trim()).filter(f => f);
            const uniqueFields = []; const seen = new Set();
            allFields.forEach(f => {
                const apiName = f.split(':')[0].trim();
                if (!seen.has(apiName)) {
                    seen.add(apiName);
                    const isVisible = cols.includes(apiName);
                    let label = apiName;
                    const col = this.columns.find(c => c.fieldName === apiName.replaceAll('.', DOT_SEP));
                    if (col) label = col.label;
                    else if (this.caseInfo?.data?.fields[apiName]) label = this.caseInfo.data.fields[apiName].label;
                    uniqueFields.push({ apiName: apiName, label: label, selected: isVisible });
                }
            });
            this.selectableFields = uniqueFields; this.isExportModalOpen = true; 
        }
    
        handleSelectAll(event) {
            const checked = event.target.checked;
            this.selectableFields = this.selectableFields.map(f => ({ ...f, selected: checked }));
        }
        closeExportModal() { this.isExportModalOpen = false; }
        handleFieldToggle(event) { this.selectableFields = this.selectableFields.map(f => f.apiName === event.target.dataset.id ? { ...f, selected: event.target.checked } : f); }
    
        async downloadCSV() {
            const selectedFields = this.selectableFields.filter(f => f.selected);
            const apiNames = selectedFields.map(f => f.apiName);
            this.closeExportModal();
            try {
                const data = await getCaseList({ 
                    dashboardId: this.currentDashboardId, accountId: this.currentAccountId, fields: apiNames, limitCount: 1000,
                    searchTerm: this.searchTerm, priorityFilter: this.priorityFilter, onlyMine: this.currentOnlyMine,
                    sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection,
                    advancedField: this.advancedField, advancedValue: this.advancedValue, hasJira: this.hasJiraFilter,
                    statusFilter: this.statusFilter
                });
                const flattened = this.flattenData(data);
                const headerLabels = selectedFields.map(f => f.label);
                let csv = 'Case Number,Link,' + headerLabels.join(',') + '\n';
                flattened.forEach(row => {
                    let line = `${row.CaseNumber},${window.location.origin}/lightning/r/Case/${row.Id}/view`;
                    selectedFields.forEach(f => { 
                        let val = '';
                        if (f.apiName.toLowerCase() === 'jira') {
                            const jiraData = row['Jira_Tickets__r'];
                            const tickets = Array.isArray(jiraData) ? jiraData : (jiraData ? jiraData.records : null);
                            val = tickets ? tickets.map(j => j.Name).join(', ') : '';
                        } else {
                            let k = f.apiName.includes('.') ? f.apiName.replaceAll('.', DOT_SEP) : f.apiName; 
                            val = row[k] || '';
                        }
                        line += ',"'+ String(val).replace(/"/g, '""') + '"'; 
                    });
                    csv += line + '\n';
                });
                const link = document.createElement('a');
                link.href = 'data:text/csv;base64,' + window.btoa(unescape(encodeURIComponent(csv)));
                link.download = 'Export.csv';
                link.click();
            } catch (e) { this.handleError('Export Failed', e); }
        }
    
        formatDate(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            const pad = (num) => String(num).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
    
        get sortIcon() { return this.sortedDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown'; }
        handleError(t, e) { this.dispatchEvent(new ShowToastEvent({ title: t, message: e.body?.message || e.message, variant: 'error' })); }
    }