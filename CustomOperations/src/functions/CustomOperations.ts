import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { Bundle, Device as fhirDevice, Observation as fhirObservation, FhirResource, Patient as fhirPatient, Practitioner, PractitionerRole, Consent } from "fhir/r4";
import { jwtDecode, JwtPayload } from 'jwt-decode';

const fhirURL = "https://b2324health-fhirdata.fhir.azurehealthcareapis.com"

interface JwtCustomPayload extends JwtPayload {
    oid?: string;
}

/**
 * 
 * @param request Incoming GET Patient Request, should include Authorization Header
 * @returns HttpResponse containing a filtered Patient Bundle
 */
export async function Patient(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);

    const [authToken, userId, unauthorizedError] = getAuthTokenAndUserId(request);
    if (unauthorizedError != null) {
        return unauthorizedError;
    }

    let fetchError: HttpResponseInit;
    let practitioner: Practitioner;
    [practitioner, fetchError] = await getUserPractitioner(authToken, userId);
    if (fetchError != null) {
        return fetchError;
    }

    let practitionerRole: PractitionerRole;
    [practitionerRole, fetchError] = await getUserPractitionerRole(authToken, practitioner);
    if (fetchError != null) {
        return fetchError;
    }

    let patients: fhirPatient[];
    [patients, fetchError] = await getRessources<fhirPatient>(authToken, 'Patient');
    if (fetchError != null) {
        return fetchError;
    }
    const filteredPatients = patients.filter(patient => isPatientInPractitionerOrganization(patient, practitionerRole));
    const patientBundle = getSearchBundle(filteredPatients);
    return { 'headers': { 'content-type': 'application/json' }, 'body': JSON.stringify(patientBundle) };
};

/**
 * 
 * @param request Incoming GET Device Request, should include Authorization Header
 * @returns HttpResponse containing a filtered Device Bundle
 */
export async function Device(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);
    const [authToken, userId, unauthorizedError] = getAuthTokenAndUserId(request);
    if (unauthorizedError != null) {
        return unauthorizedError;
    }

    let fetchError: HttpResponseInit;
    let practitioner: Practitioner;
    [practitioner, fetchError] = await getUserPractitioner(authToken, userId);
    if (fetchError != null) {
        return fetchError;
    }

    let practitionerRole: PractitionerRole;
    [practitionerRole, fetchError] = await getUserPractitionerRole(authToken, practitioner);
    if (fetchError != null) {
        return fetchError;
    }

    let patients: fhirPatient[];
    [patients, fetchError] = await getRessources<fhirPatient>(authToken, 'Patient');
    if (fetchError != null) {
        return fetchError;
    }

    let consents: Consent[]
    [consents, fetchError] = await getRessources<Consent>(authToken, 'Consent');
    if (fetchError != null) {
        return fetchError;
    }

    let devices: fhirDevice[]
    [devices, fetchError] = await getRessources<fhirDevice>(authToken, 'Device');
    if (fetchError != null) {
        return fetchError;
    }

    const filteredPatients = patients.filter(patient => isPatientInPractitionerOrganization(patient, practitionerRole));
    // filters device if device patient and current practitioner are in the same organization
    // or if consent is given for current practitioner and device owner is current practitioners organization
    const filteredDevices = devices.filter(device => filteredPatients.some(patient => device.patient.reference.endsWith(patient.id))
        || ((device.owner.reference === practitionerRole.organization.reference) && isPractitionerRolePermitted(consents, practitionerRole, device)));

    const deviceBundle = getSearchBundle(filteredDevices);
    return { 'headers': { 'content-type': 'application/json' }, 'body': JSON.stringify(deviceBundle) };
};

/**
 * 
 * @param request Incoming GET Observation Request, should include Authorization Header
 * @returns HttpResponse containing a filtered Observation Bundle
 */
export async function Observation(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}"`);
    const [authToken, userId, unauthorizedError] = getAuthTokenAndUserId(request);
    if (unauthorizedError != null) {
        return unauthorizedError;
    }

    let fetchError: HttpResponseInit;
    let practitioner: Practitioner;
    [practitioner, fetchError] = await getUserPractitioner(authToken, userId);
    if (fetchError != null) {
        return fetchError;
    }

    let practitionerRole: PractitionerRole;
    [practitionerRole, fetchError] = await getUserPractitionerRole(authToken, practitioner);
    if (fetchError != null) {
        return fetchError;
    }

    let patients: fhirPatient[];
    [patients, fetchError] = await getRessources<fhirPatient>(authToken, 'Patient');
    if (fetchError != null) {
        return fetchError;
    }

    let consents: Consent[]
    [consents, fetchError] = await getRessources<Consent>(authToken, 'Consent');
    if (fetchError != null) {
        return fetchError;
    }

    let devices: fhirDevice[]
    [devices, fetchError] = await getRessources<fhirDevice>(authToken, 'Device');
    if (fetchError != null) {
        return fetchError;
    }

    let observations: fhirObservation[]
    [observations, fetchError] = await getRessources<fhirObservation>(authToken, 'Observation');
    if (fetchError != null) {
        return fetchError;
    }
    //first two steps are the same filter steps as Device Handler function
    const filteredPatients = patients.filter(patient => isPatientInPractitionerOrganization(patient, practitionerRole));
    const filteredDevices = devices.filter(device => filteredPatients.some(patient => device.patient.reference.endsWith(patient.id))
        || ((device.owner.reference === practitionerRole.organization.reference) && isPractitionerRolePermitted(consents, practitionerRole, device)));
    //filters observations if observation patient matches a patient in filtered patiens list
    // or filters observation if observation device id matches a device in the filtered device list
    const filteredObservations = observations.filter(observation => filteredPatients.some(patient => observation.subject.reference.endsWith(patient.id))
        || (filteredDevices.some(device => observation.device.reference.endsWith(device.id))));

    const observationBundle = getSearchBundle(filteredObservations);
    return { 'headers': { 'content-type': 'application/json' }, 'body': JSON.stringify(observationBundle) };
};
// extracts token and user id from Authorization header
function getAuthTokenAndUserId(request): [authToken: string | undefined, userId: string | undefined, httpError: HttpResponseInit | undefined] {
    if (!request.headers.get('Authorization')) {
        return [undefined, undefined, { status: 401 }];
    }
    const authToken: string = request.headers.get('Authorization');
    const userId: string = (jwtDecode(authToken) as JwtCustomPayload).oid;
    return [authToken, userId, undefined]
};
// takes a FhirResourceArray and wraps it in a Bundle
function getSearchBundle(ressources: FhirResource[]): Bundle {
    return {
        resourceType: "Bundle",
        type: "searchset",
        entry: ressources.map(ressource => ({
            fullUrl: fhirURL + '/' + ressource.resourceType + '/' + ressource.id,
            resource: ressource,
            search: { mode: "match" }
        }))
    }
};
// takes a FhirResource Type and sends a fetch request to the fhir server
async function getRessources<T extends FhirResource>(authToken: string, endpoint: T['resourceType']): Promise<[devices: T[] | undefined, httpError: HttpResponseInit | undefined]> {
    const ressourceResponse = await fetch(fhirURL + '/' + endpoint, {
        method: 'GET',
        headers: {
            'Authorization': authToken,
        }
    });
    const ressourceBody = await ressourceResponse.json() as Bundle;
    if (ressourceBody.resourceType !== 'Bundle') {
        return [undefined, { status: 500 }];
    }
    const ressources = ressourceBody.entry.filter(entry => entry.resource.resourceType === endpoint).map(entry => entry.resource as T);
    return [ressources, undefined]
};

async function getUserPractitionerRole(authToken, practitioner): Promise<[practitionerRole: PractitionerRole | undefined, httpError: HttpResponseInit | undefined]> {
    const [practitionerRoles, fetchError] = await getRessources<PractitionerRole>(authToken, 'PractitionerRole');
    if (fetchError != null) {
        return [undefined, fetchError];
    }
    const filteredPractitioners = practitionerRoles.filter(practitionerRole => practitionerRole.practitioner.reference.endsWith('Practitioner/' + practitioner.id));
    if (filteredPractitioners.length !== 1) {
        return [undefined, { status: 500 }];
    }
    return [filteredPractitioners[0], undefined]
};

async function getUserPractitioner(authToken: string, userId: string): Promise<[practitioner: Practitioner | undefined, httpError: HttpResponseInit | undefined]> {
    const [practitioners, fetchError] = await getRessources<Practitioner>(authToken, 'Practitioner');
    if (fetchError != null) {
        return [undefined, fetchError]
    }
    const filteredPractitioners = practitioners.filter(practitioner => practitioner.identifier?.some(identifier => identifier.value === userId));
    if (filteredPractitioners.length !== 1) {
        return [undefined, { status: 403 }];
    }
    return [filteredPractitioners[0], undefined];
};

function isPatientInPractitionerOrganization(patient: fhirPatient, practitionerRole: PractitionerRole) {
    return patient.managingOrganization?.reference === practitionerRole.organization.reference;
};

function isPractitionerRolePermitted(consents: Consent[], practitionerRole: PractitionerRole, device: fhirDevice) {
    return consents.some(consent => consent.provision.actor.some(actor => actor.role.coding
        .some(coding => coding.code === "GRANTEE"))
        && consent.provision.type === 'permit'
        && consent.provision.actor.some(actor => actor.reference.reference.endsWith(practitionerRole.id)
        && consent.patient.reference === device.patient.reference))
};

app.http('Patient', {
    methods: ['GET'],

    authLevel: 'anonymous',
    handler: Patient
});

app.http('Device', {
    methods: ['GET'],

    authLevel: 'anonymous',
    handler: Device
});

app.http('Observation', {
    methods: ['GET'],

    authLevel: 'anonymous',
    handler: Observation
});
