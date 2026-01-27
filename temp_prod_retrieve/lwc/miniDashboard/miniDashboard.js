import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CASE_OBJECT from '@salesforce/schema/Case';
import CASE_ACCOUNT_ID from '@salesforce/schema/Case.AccountId';
import CONTACT_ACCOUNT_ID from '@salesforce/schema/Contact.AccountId';
import { EnclosingTabId, openTab, onTabFocused, IsConsoleNavigation } from 'lightning/platformWorkspaceApi';
import getDashboardData from '@salesforce/apex/MiniDashboardController.getDashboardData';
import getCaseList from '@salesforce/apex/MiniDashboardController.getCaseList';

const FIELDS_MAP = {
    Contact: [CONTACT_ACCOUNT_ID, 'Contact.Account.AVB_ICAO_Account__c'],
    Case: [CASE_ACCOUNT_ID, 'Case.AVB_ICAO_Account__c'],
    Account: ['Account.Id', 'Account.AVB_ICAO_Account__c']
};

const DEFAULT_COLUMNS = 'Subject, Priority, CreatedDate';

export default class MiniDashboard extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    @api newThreshold = 5;
    @api openThreshold = 10;
    @api waitingThreshold = 5;
    @api holdThreshold = 5;
    
    @api columnFields = DEFAULT_COLUMNS;
    @api defaultSortField = 'CreatedDate';
    @api defaultSortDirection = 'desc';
    @api pollingFrequency = 60;

    @api thresholdColor = '#ff0000';
    @api normalColor = '#000000';

    @track totalItems = this.initItems();
    @track accountItems = this.initItems();
    @track isWide = false;

    // Modal state
    @track isModalOpen = false;
    @track modalTitle = '';
    @track modalData = [];
    @track columns = [];
    @track sortedBy;
    @track sortedDirection;
    @track searchTerm = '';
    
    isLoadingModal = false;
    isMoreDataAvailable = true;
    offset = 0;
    limit = 20;

    @wire(EnclosingTabId) enclosingTabId;

    @wire(getObjectInfo, { objectApiName: CASE_OBJECT })
    caseInfo;

    @wire(IsConsoleNavigation) isConsole;

    accountId;
    icaoValue;
    pollingInterval;
    currentDashboardId;
    currentAccountId;
    searchTimer;
    resizeObserver;
    tabFocusedHandler;
    
    advancedField;
    advancedValue;

    // Visibility management
    isTabFocused = true;
    isBrowserVisible = true;

    initItems() {
        return [
            { id: 'New', label: 'N', fullLabel: 'New', count: 0, cssClass: 'count-wrapper', color: '#000000', barColor: '#81C784' },
            { id: 'Open', label: 'O', fullLabel: 'Open', count: 0, cssClass: 'count-wrapper', color: '#000000', barColor: '#E57373' },
            { id: 'Waiting for Customer', label: 'W', fullLabel: 'Waiting', count: 0, cssClass: 'count-wrapper', color: '#000000', barColor: '#64B5F6' },
            { id: 'On Hold', label: 'H', fullLabel: 'Hold', count: 0, cssClass: 'count-wrapper', color: '#000000', barColor: '#90A4AE' }
        ];
    }

    @wire(getRecord, { recordId: '$recordId', fields: '$currentFields' })
    wiredRecord({ error, data }) {
        if (data) {
            let accId;
            let icao;
            if (this.objectApiName === 'Account') {
                accId = this.recordId;
                icao = getFieldValue(data, 'Account.AVB_ICAO_Account__c');
            } else if (this.objectApiName === 'Contact') {
                accId = getFieldValue(data, CONTACT_ACCOUNT_ID);
                icao = getFieldValue(data, 'Contact.Account.AVB_ICAO_Account__c');
            } else if (this.objectApiName === 'Case') {
                accId = getFieldValue(data, CASE_ACCOUNT_ID);
                icao = getFieldValue(data, 'Case.AVB_ICAO_Account__c');
            }
            this.accountId = accId;
            this.icaoValue = icao;
            // Instant refresh on load
            this.fetchData();
        } else if (error) {
            this.handleError('Error loading record context', error);
        }
    }

    get currentFields() {
        return FIELDS_MAP[this.objectApiName] || [];
    }

    get showAccountRow() {
        return !!this.accountId;
    }

    get accountRowLabel() {
        return this.icaoValue ? this.icaoValue : 'Account';
    }

    get hasNoModalResults() {
        return !this.isLoadingModal && this.modalData.length === 0;
    }

    connectedCallback() {
        this.startPolling();
        
        // Listen for browser tab changes
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        
        // Safely listen for Salesforce Console tab focus
        if (onTabFocused) {
            this.tabFocusedHandler = onTabFocused((event) => {
                const currentTabId = this.enclosingTabId?.data;
                if (event.tabId === currentTabId) {
                    this.isTabFocused = true;
                    this.fetchData(); 
                    this.startPolling(); 
                } else {
                    this.isTabFocused = false;
                    this.stopPolling();
                }
            });
        }
    }

    handleVisibilityChange = () => {
        this.isBrowserVisible = document.visibilityState === 'visible';
        if (this.isBrowserVisible) {
            this.fetchData();
            this.startPolling();
        } else {
            this.stopPolling();
        }
    }

    renderedCallback() {
        if (!this.resizeObserver) {
            const container = this.template.querySelector('.dashboard-container');
            if (container) {
                this.resizeObserver = new ResizeObserver(entries => {
                    for (let entry of entries) {
                        this.isWide = entry.contentRect.width > 450;
                    }
                });
                this.resizeObserver.observe(container);
            }
        }
    }

    disconnectedCallback() {
        this.stopPolling();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        clearTimeout(this.searchTimer);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    startPolling() {
        this.stopPolling();
        // Only poll if focused and visible
        if (!this.isTabFocused || !this.isBrowserVisible) return;

        const freq = (this.pollingFrequency && this.pollingFrequency >= 5) ? this.pollingFrequency : 60;
        this.pollingInterval = setInterval(() => {
            this.fetchData();
        }, freq * 1000);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    fetchData() {
        // Final guard to prevent hidden polling
        if (!this.isBrowserVisible || (!this.isTabFocused && this.enclosingTabId?.data)) return;

        getDashboardData({ accountId: this.accountId })
            .then(result => {
                this.totalItems = this.processData(this.totalItems, result.totals, true);
                if (result.accountSpecific) {
                    this.accountItems = this.processData(this.accountItems, result.accountSpecific, false);
                }
            })
            .catch(error => {
                console.error('Error fetching dashboard data:', error);
            });
    }

    processData(items, data, isTotalRow) {
        return items.map(item => {
            const newCount = data[item.id] || 0;
            const hasChanged = newCount !== item.count;
            
            let threshold = 0;
            if (item.id === 'New') threshold = this.newThreshold;
            else if (item.id === 'Open') threshold = this.openThreshold;
            else if (item.id === 'Waiting for Customer') threshold = this.waitingThreshold;
            else if (item.id === 'On Hold') threshold = this.holdThreshold;

            const isOverThreshold = newCount > threshold;
            const textColor = isOverThreshold ? this.thresholdColor : this.normalColor;

            if (hasChanged) {
                this.scheduleClassRemoval(isTotalRow ? 'total' : 'account', item.id);
            }

            return {
                ...item,
                count: newCount,
                color: textColor,
                itemStyle: `color: ${textColor}`,
                barStyle: `background-color: ${item.barColor}`,
                cssClass: hasChanged ? 'count-wrapper pop-out' : item.cssClass
            };
        });
    }

    scheduleClassRemoval(type, itemId) {
        setTimeout(() => {
            if (type === 'total') {
                this.totalItems = this.totalItems.map(i => i.id === itemId ? { ...i, cssClass: 'count-wrapper' } : i);
            } else {
                this.accountItems = this.accountItems.map(i => i.id === itemId ? { ...i, cssClass: 'count-wrapper' } : i);
            }
        }, 1000);
    }

    handleItemClick(event) {
        this.currentDashboardId = event.currentTarget.dataset.id;
        const scope = event.currentTarget.dataset.scope;
        this.currentAccountId = scope === 'account' ? this.accountId : null;

        const scopeLabel = scope === 'account' ? (this.icaoValue || 'Account') : 'Global';
        this.modalTitle = `${this.currentDashboardId} Cases (${scopeLabel})`;
        
        this.resetModal();
        this.isModalOpen = true;
        this.isLoadingModal = true;
        
        const fieldList = this.columnFields.split(',').map(f => f.trim());
        this.buildColumns(fieldList);

        this.loadModalData();
    }

    resetModal() {
        this.modalData = [];
        this.offset = 0;
        this.searchTerm = '';
        this.advancedField = null;
        this.advancedValue = null;
        this.isMoreDataAvailable = true;
        this.sortedBy = this.defaultSortField.replace('.', '_');
        this.sortedDirection = this.defaultSortDirection;
    }

    loadModalData() {
        const fieldList = this.columnFields.split(',').map(f => f.trim());
        const sortField = this.sortedBy ? this.sortedBy.replace('_', '.') : this.defaultSortField;
        
        getCaseList({ 
            dashboardId: this.currentDashboardId, 
            accountId: this.currentAccountId, 
            fields: fieldList,
            sortField: sortField,
            sortOrder: this.sortedDirection,
            searchTerm: this.searchTerm,
            offset: this.offset,
            advancedField: this.advancedField,
            advancedValue: this.advancedValue
        })
            .then(data => {
                const flattened = this.flattenData(data).map(c => ({
                    ...c,
                    caseUrl: `/lightning/r/Case/${c.Id}/view`
                }));

                if (this.offset === 0) {
                    this.modalData = flattened;
                } else {
                    this.modalData = [...this.modalData, ...flattened];
                }

                this.isMoreDataAvailable = flattened.length === this.limit;
            })
            .catch(error => {
                this.handleError('Error fetching case list', error);
            })
            .finally(() => {
                this.isLoadingModal = false;
                const datatable = this.template.querySelector('lightning-datatable');
                if (datatable) datatable.isLoading = false;
            });
    }

    handleLoadMore(event) {
        if (this.isMoreDataAvailable && !this.isLoadingModal) {
            const datatable = event.target;
            datatable.isLoading = true;
            this.offset += this.limit;
            this.loadModalData();
        }
    }

    handleSearch(event) {
        const term = event.target.value;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.parseSearch(term);
            this.offset = 0;
            this.isLoadingModal = true;
            this.loadModalData();
        }, 500);
    }

    parseSearch(term) {
        this.searchTerm = term;
        this.advancedField = null;
        this.advancedValue = null;

        const separator = term.includes('=') ? '=' : (term.includes(':') ? ':' : (term.includes(';') ? ';' : null));
        
        if (separator) {
            const parts = term.split(separator);
            if (parts.length === 2) {
                const label = parts[0].trim().toLowerCase();
                const value = parts[1].trim();
                
                const fieldApiName = this.findFieldByLabel(label);
                if (fieldApiName) {
                    this.advancedField = fieldApiName;
                    this.advancedValue = value;
                }
            }
        }
    }

    findFieldByLabel(searchLabel) {
        if (!this.caseInfo || !this.caseInfo.data) return null;
        
        const fields = this.caseInfo.data.fields;
        for (const apiName in fields) {
            if (fields[apiName].label.toLowerCase() === searchLabel) {
                return apiName;
            }
        }

        const fieldList = this.columnFields.split(',').map(f => f.trim());
        for (const f of fieldList) {
            if (f.includes('.')) {
                const parts = f.split('.');
                const syntheticLabel = (parts[0] + ' ' + parts[1]).toLowerCase();
                if (syntheticLabel === searchLabel) {
                    return f;
                }
            }
        }
        return null;
    }

    flattenData(data) {
        return data.map(record => {
            let flatRecord = { ...record };
            Object.keys(record).forEach(key => {
                if (typeof record[key] === 'object' && record[key] !== null) {
                    Object.keys(record[key]).forEach(nestedKey => {
                        flatRecord[`${key}_${nestedKey}`] = record[key][nestedKey];
                    });
                }
            });
            return flatRecord;
        });
    }

    buildColumns(fieldList) {
        const cols = [
            { 
                label: this.caseInfo?.data?.fields?.CaseNumber?.label || 'Case Number', 
                fieldName: 'CaseNumber', 
                type: 'button', 
                sortable: true,
                typeAttributes: { 
                    label: { fieldName: 'CaseNumber' }, 
                    name: 'view_case', 
                    variant: 'base',
                    class: 'slds-text-link'
                } 
            }
        ];

        fieldList.forEach(field => {
            if (field.toLowerCase() === 'casenumber') return;

            let fieldName = field;
            let label = field;
            let type = 'text';
            let typeAttributes = {};

            if (field.includes('.')) {
                fieldName = field.replace('.', '_');
                const parts = field.split('.');
                label = parts[0] + ' ' + parts[1];
            } else {
                const fieldMetadata = this.caseInfo?.data?.fields[field];
                label = fieldMetadata ? fieldMetadata.label : field;

                if (field.toLowerCase().includes('date') || (fieldMetadata && (fieldMetadata.dataType === 'DateTime' || fieldMetadata.dataType === 'Date'))) {
                    type = 'date';
                    typeAttributes = { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                }
            }

            cols.push({
                label: label,
                fieldName: fieldName,
                type: type,
                sortable: true,
                typeAttributes: typeAttributes
            });
        });

        this.columns = cols;
    }

    async handleRowAction(event) {
        const actionName = event.detail.action.name;
        const row = event.detail.row;

        if (actionName === 'view_case') {
            try {
                await openTab({
                    recordId: row.Id,
                    focus: true,
                    overrideNavRules: true
                });
            } catch (error) {
                this.navigateToRecord(row.Id);
            }
            this.closeModal();
        }
    }

    navigateToRecord(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: recordId,
                actionName: 'view'
            }
        });
    }

    handleSort(event) {
        const { fieldName: sortedBy, sortDirection } = event.detail;
        this.sortedBy = sortedBy;
        this.sortedDirection = sortDirection;
        this.offset = 0;
        this.isLoadingModal = true;
        this.loadModalData();
    }

    closeModal() {
        this.isModalOpen = false;
    }

    handleStopPropagation(event) {
        event.stopPropagation();
    }

    handleError(title, error) {
        console.error(title, error);
        let message = 'Unknown error';
        if (error.body && Array.isArray(error.body)) {
            message = error.body.map(e => e.message).join(', ');
        } else if (error.body && typeof error.body.message === 'string') {
            message = error.body.message;
        }
        this.dispatchEvent(
            new ShowToastEvent({
                title: title,
                message: message,
                variant: 'error'
            })
        );
    }
}